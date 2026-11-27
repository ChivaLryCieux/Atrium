import type { ChatMessage } from "../types/chat";
import { mergeTokenHighWaterMark } from "./tokens";

/**
 * Pure merge reducers for kernel stream events. Extracted from the former
 * duplicated implementations in useKernelStreams / useSendMessage so there is
 * exactly one merge semantics, unit-testable without React.
 *
 * Matching rule (unified): an event targets the message whose id equals its
 * stageId; events without a stageId fall back to the pending assistant node.
 */

export interface MergeContext {
  activeSessionId: string | null;
  thinkingText: string;
  stageAnalyzingText: string;
}

export interface KernelEventPayload {
  type?: string;
  conversationId?: string;
  stageId?: string | null;
  content?: string;
  isReasoning?: boolean;
  event?: any;
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number };
  detail?: string;
  [key: string]: unknown;
}

/** Parallel-mode sub-conversations are suffixed `::parallel-N`; prefix matching
 * keeps their deltas flowing into the same session view. */
export function targetsActiveSession(
  payload: KernelEventPayload,
  activeSessionId: string | null,
): boolean {
  if (!payload.conversationId || !activeSessionId) return true;
  return payload.conversationId.startsWith(activeSessionId);
}

function matchesStage(msg: ChatMessage, stageId: string | null | undefined): boolean {
  return stageId ? msg.id === stageId : Boolean(msg.pending) && msg.role === "assistant";
}

export function isPlaceholderContent(content: string, ctx: MergeContext): boolean {
  return (
    content === ctx.thinkingText ||
    content.includes(ctx.stageAnalyzingText) ||
    (content.startsWith("[") && content.includes("]"))
  );
}

export function mergeStreamChunk(
  messages: ChatMessage[],
  payload: KernelEventPayload,
  ctx: MergeContext,
): ChatMessage[] {
  const { stageId, content, isReasoning } = payload;
  if (!content) return messages;
  let changed = false;
  const next = messages.map((msg) => {
    if (!matchesStage(msg, stageId) || !msg.pending) return msg;
    changed = true;
    if (isReasoning) {
      return { ...msg, reasoningContent: (msg.reasoningContent || "") + content };
    }
    return {
      ...msg,
      content: isPlaceholderContent(msg.content, ctx) ? content : msg.content + content,
    };
  });
  return changed ? next : messages;
}

export function mergeToolEvent(messages: ChatMessage[], payload: KernelEventPayload): ChatMessage[] {
  const toolEvt = payload.event;
  if (!toolEvt) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (!matchesStage(m, payload.stageId)) return m;
    changed = true;
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
  });
  return changed ? next : messages;
}

export function mergeTokenUsageEvent(
  messages: ChatMessage[],
  payload: KernelEventPayload,
): ChatMessage[] {
  const { usage } = payload;
  if (!usage) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (!matchesStage(m, payload.stageId)) return m;
    changed = true;
    // Append-only accounting: attempt/retry notifications may arrive out of
    // order with smaller values; never let a counter regress.
    return { ...m, ...mergeTokenHighWaterMark(m, usage) };
  });
  return changed ? next : messages;
}

export function mergeAgentStatusEvent(
  messages: ChatMessage[],
  payload: KernelEventPayload,
): ChatMessage[] {
  const { detail } = payload;
  if (!detail) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (!matchesStage(m, payload.stageId) || !m.pending) return m;
    changed = true;
    return { ...m, statusDetail: detail };
  });
  return changed ? next : messages;
}

/** Single entry point: session filtering + type dispatch. Unknown types pass through as no-ops. */
export function applyKernelEvent(
  messages: ChatMessage[],
  payload: KernelEventPayload,
  ctx: MergeContext,
): ChatMessage[] {
  if (!payload || typeof payload !== "object") return messages;
  if (!targetsActiveSession(payload, ctx.activeSessionId)) return messages;
  switch (payload.type) {
    case "assistant-stream":
      return mergeStreamChunk(messages, payload, ctx);
    case "tool-event":
      return mergeToolEvent(messages, payload);
    case "token-usage":
      return mergeTokenUsageEvent(messages, payload);
    case "agent-status":
      return mergeAgentStatusEvent(messages, payload);
    default:
      return messages;
  }
}
