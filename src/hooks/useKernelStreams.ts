import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { dshClient } from "../services/dshClient";
import { mergeTokenHighWaterMark } from "../utils/tokens";
import type { ChatMessage } from "../types/chat";

export type KernelStreamRefs = {
  isSendingRef: MutableRefObject<boolean>;
  activeSessionIdRef: MutableRefObject<string | null>;
  tRef: MutableRefObject<(k: string) => string>;
};

type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>;

/**
 * Live kernel fan-in: assistant-stream / tool-event / token-usage /
 * agent-status all converge here and merge into the matching pending node.
 * Parallel-mode sub-conversations are suffixed `::parallel-N`, so prefix
 * matching keeps their deltas flowing to the same session view.
 *
 * High-frequency UI merge — intentionally stays in the frontend; moving it
 * behind invoke/event round-trips would stall per-token updates.
 */
export function useKernelStreams(setMessages: SetMessages, refs: KernelStreamRefs) {
  useEffect(() => {
    const { isSendingRef, activeSessionIdRef, tRef } = refs;

    // Live kernel stream: streamed deltas land in the matching pending node.
    const unlistenStream = dshClient.onStream((chunk) => {
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (chunk.conversationId && active && !chunk.conversationId.startsWith(active)) return;
      if (!chunk.stageId || !chunk.content) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== chunk.stageId || !msg.pending) return msg;
          if (chunk.isReasoning) {
            return {
              ...msg,
              reasoningContent: (msg.reasoningContent || "") + chunk.content,
            };
          }
          const isPlaceholder =
            msg.content === tRef.current("app.thinking") ||
            msg.content.includes(tRef.current("app.stageAnalyzing")) ||
            (msg.content.startsWith("[") && msg.content.includes("]"));
          return { ...msg, content: isPlaceholder ? chunk.content! : msg.content + chunk.content! };
        }),
      );
    });

    // Real-time tool-call telemetry from kernel
    const unlistenToolEvent = dshClient.onToolEvent((msg) => {
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches) return m;

          const currentTools = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
          if (msg.event.kind === "call") {
            const item = msg.event.item;
            const idx = currentTools.findIndex((t) => t.id === item.id);
            if (idx >= 0) {
              currentTools[idx] = { ...currentTools[idx], ...item };
            } else {
              currentTools.push(item);
            }
          } else if (msg.event.kind === "result") {
            const { callId, result, isError, error, status } = msg.event;
            const idx = currentTools.findIndex((t) => t.id === callId);
            if (idx >= 0) {
              currentTools[idx] = {
                ...currentTools[idx],
                result,
                isError,
                error,
                status,
              };
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
    });

    // Real-time token usage telemetry from kernel
    const unlistenTokenUsage = dshClient.onTokenUsage((msg) => {
      if (isSendingRef.current) return;
      const usage = msg.usage;
      if (!usage) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches) return m;
          // 词元计量只增不减：内核的 attempt/重试或子步骤通知可能乱序到达
          // 且用量更小，直接覆写会让计数器回落。按字段取高水位。
          return { ...m, ...mergeTokenHighWaterMark(m, usage) };
        })
      );
    });

    // Real-time agent status telemetry from kernel
    const unlistenAgentStatus = dshClient.onAgentStatus((msg) => {
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches || !m.pending) return m;
          return {
            ...m,
            statusDetail: msg.detail,
          };
        })
      );
    });

    return () => {
      unlistenStream();
      unlistenToolEvent();
      unlistenTokenUsage();
      unlistenAgentStatus();
    };
    // setMessages is React-stable; refs are stable containers mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMessages]);
}
