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
 * invoke orchestration → settle merge (token high-water-mark, toolCalls,
 * reasoning) → persist. Live stream merging is owned exclusively by the
 * always-on useKernelStreams fan-in; this pipeline only handles the final
 * settle, so there is exactly one merge path and nothing to double-apply.
 */
export function useSendMessage(deps: SendPipelineDeps) {
  const handleSend = async (overrideText?: unknown) => {
    const text = typeof overrideText === 'string' ? overrideText : undefined;
    await sendPipeline(deps, text);
  };
  const handlePause = async () => {
    await pausePipeline(deps);
  };
  return { handleSend, handlePause };
}

async function sendPipeline(d: SendPipelineDeps, overrideText?: string) {
  const { settings, activeProfile, t } = d;
  const rawText = typeof overrideText === 'string' ? overrideText : d.draft;
  const content = (rawText || '').trim();
  if (!content || !activeProfile || !settings || d.isSending) return;

  let curSessionId = d.activeSessionId;
  if (!curSessionId) {
    curSessionId = await ensureSession(d);
  }
  if (curSessionId) {
    d.activeSessionIdRef.current = curSessionId;
  }
  dshClient.ensureConnected();

  const userMessage = createUserMessage(content, settings.userName || "Tempsyche");
  const baseMessages = [...d.messages, userMessage];
  const pendingMessages = buildPendingMessages(d, t);

  if (overrideText === undefined) {
    d.setDraft("");
  }
  d.isSendingRef.current = true;
  d.setIsSending(true);
  d.setMessages([...baseMessages, ...pendingMessages]);

  let unlistenProgress: (() => void) | null = null;

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
    // Session-switch guard: if the operator navigated away mid-turn, the view
    // now shows another session — the server-side persist already recorded
    // this turn keyed by conversation, so simply leave the current view alone.
    if (d.activeSessionIdRef.current === curSessionId) {
      d.setMessages((prev) => settleReplies(d, prev, baseMessages, finalReplies, curSessionId));
    }
    refreshSessionIndex(d, curSessionId, baseMessages.length + finalReplies.length);
  } catch (error) {
    if (!d.isSendingRef.current) {
      // Intentionally aborted / paused by operator, do not treat as dispatch failure
      return;
    }
    if (d.activeSessionIdRef.current === curSessionId) {
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
    }
  } finally {
    if (unlistenProgress) {
      unlistenProgress();
    }
    d.isSendingRef.current = false;
    d.setIsSending(false);
  }
}

/**
 * Bump the touched session's index row (messageCount / updatedAt) from the
 * payload already in memory — no extra list_sessions round-trip. The server
 * side persists the message file + index inside execute_orchestration; this
 * only keeps the local sidebar ordering in step.
 */
function refreshSessionIndex(d: SendPipelineDeps, curSessionId: string | null, messageCount: number) {
  if (!curSessionId) return;
  d.setSessions((prevSessions) =>
    prevSessions.map((s) =>
      s.id === curSessionId
        ? { ...s, messageCount, updatedAt: Math.floor(Date.now() / 1000) }
        : s
    )
  );
}

async function pausePipeline(d: SendPipelineDeps) {
  if (!d.isSendingRef.current) return;
  d.isSendingRef.current = false;
  d.setIsSending(false);

  const curSessionId = d.activeSessionIdRef.current || d.activeSessionId;
  if (curSessionId) {
    try {
      await invoke("abort_orchestration", { conversationId: curSessionId });
    } catch (err) {
      console.warn("Failed to abort orchestration:", err);
    }
  }

  d.setMessages((prev) =>
    prev.map((msg) => {
      if (!msg.pending) return msg;
      const isPlaceholder =
        msg.content === d.tRef.current("app.thinking") ||
        msg.content.includes(d.tRef.current("app.stageAnalyzing")) ||
        (msg.content.startsWith("[") && msg.content.includes("]"));
      const pausedTag = `\n\n*(${d.tRef.current("app.pausedByUser")})*`;
      return {
        ...msg,
        pending: false,
        paused: true,
        content: isPlaceholder
          ? d.tRef.current("app.pausedByUser")
          : (msg.content.endsWith(pausedTag) ? msg.content : `${msg.content}${pausedTag}`),
      };
    })
  );
}

async function ensureSession(d: SendPipelineDeps): Promise<string | null> {
  const { t } = d;
  try {
    // Title numbering lives in the kernel: it scans the stored index, so the
    // caller no longer needs the full session list just to name a task.
    const title = await generateSessionTitle(d.activeProjectId, t);
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

/**
 * Default task title via the Rust storage layer: `generate_session_title`
 * scans the stored session index (max+1 with a length+1 floor) and the
 * webview localizes the final "任务N：M.D" string.
 */
export async function generateSessionTitle(
  projectId: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<string> {
  const parts = await invoke<{ number: number; date: string }>("generate_session_title", {
    projectId,
  });
  return t("sidebar.defaultTaskTitle", {
    number: parts.number,
    date: parts.date,
    defaultValue: `任务${parts.number}：${parts.date}`,
  });
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

function settleReplies(
  d: SendPipelineDeps,
  prev: ChatMessage[],
  baseMessages: ChatMessage[],
  finalReplies: ChatMessage[],
  curSessionId: string | null
): ChatMessage[] {
  const pendingList = prev.filter((m) => m.pending);
  const mergedReplies = finalReplies.map((reply, idx) => {
    const pending = prev.find((m) => m.id === reply.id && m.pending) ?? pendingList[idx];
    const rawToolCalls =
      reply.toolCalls && reply.toolCalls.length > 0 ? reply.toolCalls : pending?.toolCalls ?? null;
    const toolCalls = rawToolCalls
      ? rawToolCalls.map((tc) =>
          tc.status === "running"
            ? { ...tc, status: reply.error ? ("error" as const) : ("completed" as const), result: tc.result || "执行完成" }
            : tc
        )
      : null;
    // 结算合并同样走高水位：回复载荷若缺失/小于流式期间已记录的
    // 内核精确值，保留较大者，避免「落定瞬间数字回落」。
    const watermark = mergeTokenHighWaterMark(pending ?? {}, {
      inputTokens: reply.promptTokens ?? 0,
      outputTokens: reply.completionTokens ?? 0,
    });
    const finalId =
      reply.id && !reply.id.endsWith("-single") && !reply.id.startsWith("stage-")
        ? reply.id
        : (typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${reply.id || "msg"}-${Date.now()}-${idx}`);

    return {
      ...reply,
      id: finalId,
      toolCalls,
      promptTokens: watermark.promptTokens || null,
      completionTokens: watermark.completionTokens || null,
      reasoningContent: reply.reasoningContent || pending?.reasoningContent || null,
      paused: reply.paused || pending?.paused || false,
    };
  });
  return [...baseMessages, ...mergedReplies];
}
