import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AiProfile,
  AppSettings,
  ChatMessage,
  ExecutionMode,
  OrchestrationProgressEvent,
  OrchestrationStage,
  PendingMessage,
  ReasoningEffort,
  SessionSummary,
} from "../types/chat";
import { createUserMessage } from "../constants/defaults";
import { createPendingMessages } from "../utils/messages";
import { generateDefaultTaskTitle } from "../utils/tasks";
import { mergeTokenHighWaterMark } from "../utils/tokens";
import { dshClient } from "../services/dshClient";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

export type SendPipelineDeps = {
  settings: AppSettings | null;
  activeProfile: AiProfile | null;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  executionMode: ExecutionMode;
  orchestrationStages: OrchestrationStage[];
  draft: string;
  isSending: boolean;
  messages: ChatMessage[];
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeProjectId: string | null;
  activeSessionIdRef: MutableRefObject<string | null>;
  isSendingRef: MutableRefObject<boolean>;
  tRef: MutableRefObject<(key: string) => string>;
  setDraft: Dispatch<SetStateAction<string>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  t: (key: string) => string;
};

/**
 * Core send pipeline: ensure session → optimistic user+pending nodes →
 * dual-channel live merge (Tauri events + WS fallback) → settle merge
 * (token high-water-mark, toolCalls, reasoning) → persist.
 */
export function useSendMessage(deps: SendPipelineDeps) {
  const handleSend = async () => {
    await sendPipeline(deps);
  };
  return { handleSend };
}

async function sendPipeline(d: SendPipelineDeps) {
  const { settings, activeProfile, t } = d;
  if (!d.draft.trim() || !activeProfile || !settings || d.isSending) return;

  let curSessionId = d.activeSessionId;
  if (!curSessionId) {
    curSessionId = await ensureSession(d);
  }
  if (curSessionId) {
    d.activeSessionIdRef.current = curSessionId;
  }
  dshClient.ensureConnected();

  const userMessage = createUserMessage(d.draft.trim(), settings.userName || "Tempsyche");
  const baseMessages = [...d.messages, userMessage];
  const pendingMessages = buildPendingMessages(d, t);

  d.setDraft("");
  d.isSendingRef.current = true;
  d.setIsSending(true);
  d.setMessages([...baseMessages, ...pendingMessages]);

  let unlistenProgress: (() => void) | null = null;
  let unlistenStreamEvent: (() => void) | null = null;

  try {
    unlistenProgress = await listen<OrchestrationProgressEvent>(
      "orchestration-progress",
      (event) => {
        const { stageId, stageTitle, status: eventStatus } = event.payload;
        if (eventStatus === "running") {
          d.setMessages((prev) =>
            prev.map((msg) =>
              msg.pending && (!stageId || msg.id === stageId) && msg.content === t("app.thinking")
                ? { ...msg, content: `[${stageTitle}] ${t("app.stageAnalyzing")}` }
                : msg
            )
          );
        }
      }
    );

    unlistenStreamEvent = await listen<any>("kernel-stream-event", (event) =>
      mergeKernelEvent(d, event.payload)
    );

    const finalReplies = await invoke<ChatMessage[]>("execute_orchestration", {
      request: {
        profiles: [
          {
            ...activeProfile,
            model: d.selectedModel || activeProfile.model,
          },
        ],
        messages: baseMessages,
        mode: settings.orchestrationMode,
        conversationId: curSessionId,
        reasoningEffort: d.reasoningEffort,
        executionMode: d.executionMode,
      },
    });

    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
    if (unlistenStreamEvent) {
      unlistenStreamEvent();
      unlistenStreamEvent = null;
    }
    d.setMessages((prev) => settleReplies(d, prev, baseMessages, finalReplies, curSessionId));
  } catch (error) {
    d.setMessages((prev) =>
      prev.map((msg) =>
        msg.pending
          ? {
              ...msg,
              content: `${t("app.dispatchError")} ${String(error)}`,
              pending: false,
              error: true,
            }
          : msg
      )
    );
  } finally {
    if (unlistenProgress) {
      unlistenProgress();
    }
    if (unlistenStreamEvent) {
      unlistenStreamEvent();
    }
    d.isSendingRef.current = false;
    d.setIsSending(false);
  }
}

async function ensureSession(d: SendPipelineDeps): Promise<string | null> {
  const { t } = d;
  try {
    const title = generateDefaultTaskTitle(d.sessions, d.activeProjectId, t);
    const created = await invoke<SessionSummary>("create_session", {
      title,
      projectId: d.activeProjectId,
    });
    d.setActiveSessionId(created.id);
    d.setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    return created.id;
  } catch (err) {
    console.error(t("app.createSessionFailed"), err);
    return d.activeSessionId;
  }
}

function buildPendingMessages(d: SendPipelineDeps, t: (key: string) => string): PendingMessage[] {
  const profile = d.activeProfile!;
  // One pending bubble per pipeline node; its id equals the stage id so the
  // kernel's streamed deltas and settled replies land in the same node.
  // Single mode has exactly one deterministic node id (`<profile>-single`,
  // mirroring the backend), so streaming matches without a random UUID.
  if (d.settings!.orchestrationMode === "single") {
    return [
      {
        id: `${profile.id}-single`,
        role: "assistant" as const,
        content: t("app.thinking"),
        speakerId: profile.id,
        speakerName: profile.name,
        avatar: profile.avatar,
        pending: true as const,
      },
    ];
  }
  if (d.orchestrationStages.length > 0) {
    return d.orchestrationStages.map((stage) => ({
      id: stage.id,
      role: "assistant" as const,
      content: t("app.thinking"),
      speakerId: stage.profile.id,
      speakerName: `${stage.title} · ${stage.profile.name}`,
      avatar: stage.profile.avatar,
      pending: true as const,
    }));
  }
  return createPendingMessages([profile]);
}

function mergeKernelEvent(d: SendPipelineDeps, payload: any) {
  if (!payload || typeof payload !== "object") return;
  const active = d.activeSessionIdRef.current;
  if (payload.conversationId && active && !payload.conversationId.startsWith(active)) return;

  if (payload.type === "assistant-stream") {
    const { stageId, content, isReasoning } = payload;
    if (!content) return;
    d.setMessages((prev) =>
      prev.map((msg) => {
        const matches = stageId ? msg.id === stageId : msg.pending && msg.role === "assistant";
        if (!matches || !msg.pending) return msg;
        if (isReasoning) {
          return { ...msg, reasoningContent: (msg.reasoningContent || "") + content };
        }
        const isPlaceholder =
          msg.content === d.tRef.current("app.thinking") ||
          msg.content.includes(d.tRef.current("app.stageAnalyzing")) ||
          (msg.content.startsWith("[") && msg.content.includes("]"));
        return { ...msg, content: isPlaceholder ? content : msg.content + content };
      })
    );
  } else if (payload.type === "tool-event") {
    const { stageId, event: toolEvt } = payload;
    if (!toolEvt) return;
    d.setMessages((prev) =>
      prev.map((m) => {
        const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
        if (!matches) return m;
        const currentTools = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
        if (toolEvt.kind === "call") {
          const item = toolEvt.item;
          const idx = currentTools.findIndex((t) => t.id === item.id);
          if (idx >= 0) currentTools[idx] = { ...currentTools[idx], ...item };
          else currentTools.push(item);
        } else if (toolEvt.kind === "result") {
          const { callId, result, isError, error, status } = toolEvt;
          const idx = currentTools.findIndex((t) => t.id === callId);
          if (idx >= 0) {
            currentTools[idx] = { ...currentTools[idx], result, isError, error, status };
          } else {
            currentTools.push({
              id: callId,
              name: "tool",
              arguments: "",
              result,
              isError,
              error,
              status,
              timestamp: Date.now(),
            });
          }
        }
        return { ...m, toolCalls: currentTools };
      })
    );
  } else if (payload.type === "token-usage") {
    return mergeTokenUsage(d, payload);
  } else if (payload.type === "agent-status") {
    return mergeAgentStatus(d, payload);
  }
}

function mergeTokenUsage(d: SendPipelineDeps, payload: any) {
  const { stageId, usage } = payload;
  if (!usage) return;
  d.setMessages((prev) =>
    prev.map((m) => {
      const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
      if (!matches) return m;
      // 同 WS 监听：乱序的小额用量通知不得让计量回落。
      return { ...m, ...mergeTokenHighWaterMark(m, usage) };
    })
  );
}

function mergeAgentStatus(d: SendPipelineDeps, payload: any) {
  const { stageId, detail } = payload;
  if (!detail) return;
  d.setMessages((prev) =>
    prev.map((m) => {
      const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
      if (!matches || !m.pending) return m;
      return { ...m, statusDetail: detail };
    })
  );
}

function settleReplies(
  d: SendPipelineDeps,
  prev: ChatMessage[],
  baseMessages: ChatMessage[],
  finalReplies: ChatMessage[],
  curSessionId: string | null
): ChatMessage[] {
  const mergedReplies = finalReplies.map((reply) => {
    const pending = prev.find((m) => m.id === reply.id);
    const toolCalls =
      reply.toolCalls && reply.toolCalls.length > 0 ? reply.toolCalls : pending?.toolCalls ?? null;
    // 结算合并同样走高水位：回复载荷若缺失/小于流式期间已记录的
    // 内核精确值，保留较大者，避免「落定瞬间数字回落」。
    const watermark = mergeTokenHighWaterMark(pending ?? {}, {
      inputTokens: reply.promptTokens ?? 0,
      outputTokens: reply.completionTokens ?? 0,
    });
    return {
      ...reply,
      toolCalls,
      promptTokens: watermark.promptTokens || null,
      completionTokens: watermark.completionTokens || null,
      reasoningContent: reply.reasoningContent || pending?.reasoningContent || null,
    };
  });
  const updatedMessages = [...baseMessages, ...mergedReplies];
  if (curSessionId) {
    invoke("save_session_messages", { sessionId: curSessionId, messages: updatedMessages })
      .then(() => {
        invoke<SessionSummary[]>("list_sessions").then(d.setSessions).catch(console.error);
      })
      .catch(console.error);
  }
  return updatedMessages;
}
