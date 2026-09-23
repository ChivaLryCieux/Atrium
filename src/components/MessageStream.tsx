import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { ChatMessage } from "../types/chat";
import { Markdown } from "./Markdown";
import { ReasoningAccordion } from "./ReasoningAccordion";
import { ToolCallTerminal } from "./ToolCallTerminal";

/**
 * Virtualized message stream (ZCode ConversationTimeline pattern, trimmed
 * for the single-column bubble layout):
 *
 * - `@tanstack/react-virtual` windowing with dynamic measurement
 *   (`measureElement`), so long sessions keep a bounded DOM.
 * - `getItemKey` keys the virtualizer's measurement cache by message id, so
 *   the streaming re-renders and StrictMode remounts (every token delta
 *   rebuilds the messages array) reuse measured heights instead of snapping
 *   back to the estimate — the scroll-jump class ZCode guards with its own
 *   row-height cache.
 * - Tail pinning: while the viewport sits near the bottom, new messages and
 *   streaming growth follow the tail; scrolling up releases the pin so the
 *   operator can read history undisturbed.
 */

type MessageStreamProps = {
  messages: ChatMessage[];
  /// Display name for the operator (user avatar + title).
  userName: string;
  onCopyMessage: (content: string) => void;
};

/// Spacing between message slots; measured into each slot so offset math
/// stays consistent.
const ROW_GAP_PX = 16;
/// Matches .chat-message-stream padding; tells the virtualizer where the
/// content box starts inside the scroll container.
const SCROLL_PADDING_TOP_PX = 24;
/// Distance from the bottom that still counts as "pinned to the tail".
const STICK_THRESHOLD_PX = 80;
const OVERSCAN = 6;

function estimateHeight(message: ChatMessage): number {
  // Per-role fallbacks for unmeasured rows (before ResizeObserver runs).
  if (message.role === "user") return 84;
  let estimate = 120;
  if (message.reasoningContent) estimate += 80;
  if (message.toolCalls && message.toolCalls.length > 0) estimate += 120;
  return estimate;
}

export function MessageStream({ messages, userName, onCopyMessage }: MessageStreamProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateHeight(messages[index]),
    getItemKey: (index) => messages[index].id,
    overscan: OVERSCAN,
    scrollMargin: SCROLL_PADDING_TOP_PX,
  });

  // Track the tail pin from the live scroll position (a user scroll away
  // from the bottom releases it; scrolling back re-engages it).
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(distance < STICK_THRESHOLD_PX);
  }, []);

  // Follow the tail while pinned: covers new messages, streamed deltas
  // (content grows), and re-engaging the pin by scrolling back down.
  // `totalSize` is a dependency because measurement pass async: rows start
  // at the estimate height and grow into their measured height, so the tail
  // must be re-anchored whenever the virtual height changes — otherwise the
  // view is left stranded above the bottom after the first measurement.
  const totalSize = virtualizer.getTotalSize();

  useEffect(() => {
    if (!pinnedToBottom || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages, pinnedToBottom, totalSize, virtualizer]);

  const rows = virtualizer.getVirtualItems();
  const displayName = userName || t("app.me");
  const avatarInitial = displayName.trim().charAt(0).toUpperCase();

  return (
    <div className="chat-message-stream" ref={parentRef} onScroll={handleScroll}>
      <div
        className="chat-message-sizer"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {rows.map((virtualRow) => {
          const msg = messages[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="message-row-slot"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: `${ROW_GAP_PX}px`,
              }}
            >
              {msg.role === "user" ? (
                <div className="message-bubble-row user">
                  <div className="bubble-body user-bubble">
                    <button
                      type="button"
                      className="bubble-copy-btn"
                      title={t("app.copyMessage")}
                      onClick={() => onCopyMessage(msg.content)}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="12" height="12" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <div className="bubble-text">{msg.content}</div>
                  </div>
                  <div className="chat-avatar user-avatar" title={displayName}>
                    {avatarInitial}
                  </div>
                </div>
              ) : (
                <div className={`message-bubble-row assistant${msg.error ? " error" : ""}`}>
                  <div className="chat-avatar ai-avatar" title={msg.speakerName}>
                    <img src="/logo.png" alt={msg.speakerName} />
                  </div>
                  <div className="bubble-body ai-bubble">
                    <div className="speaker-header">
                      <span className="speaker-name">{msg.speakerName}</span>
                    </div>
                    {(msg.reasoningContent || (msg.pending && (msg.content === t("app.thinking") || msg.content.includes(t("app.stageAnalyzing"))))) ? (
                      <ReasoningAccordion
                        reasoning={msg.reasoningContent}
                        isStreaming={Boolean(msg.pending && (msg.content === t("app.thinking") || msg.content.includes(t("app.stageAnalyzing"))))}
                        latencyMs={msg.latencyMs}
                        reasoningDurationMs={msg.reasoningDurationMs}
                        statusDetail={msg.statusDetail}
                      />
                    ) : null}
                    {(!msg.pending ||
                      (msg.content !== t("app.thinking") &&
                        !msg.content.includes(t("app.stageAnalyzing")) &&
                        !(msg.content.startsWith("[") && msg.content.includes("]")))) ? null : (
                      !msg.reasoningContent ? (
                        <div className="agent-thinking-hint">
                          {msg.statusDetail || t("app.thinking")}
                        </div>
                      ) : null
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolCallTerminal toolCalls={msg.toolCalls} />
                    )}
                    {(!msg.pending ||
                      (msg.content !== t("app.thinking") &&
                        !msg.content.includes(t("app.stageAnalyzing")) &&
                        !(msg.content.startsWith("[") && msg.content.includes("]")))) && (
                      <div className="bubble-text"><Markdown text={msg.content} /></div>
                    )}
                    {!msg.pending && (
                      <button
                        type="button"
                        className="bubble-copy-btn"
                        title={t("app.copyMessage")}
                        onClick={() => onCopyMessage(msg.content)}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="12" height="12" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
