import React, { useState, useEffect, useRef } from "react";
import { Markdown } from "./Markdown";

interface ReasoningAccordionProps {
  reasoning?: string | null;
  isStreaming?: boolean;
  latencyMs?: number | null;
  reasoningDurationMs?: number | null;
  statusDetail?: string | null;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "1s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${Math.max(1, totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export const ReasoningAccordion: React.FC<ReasoningAccordionProps> = ({
  reasoning,
  isStreaming = false,
  latencyMs,
  reasoningDurationMs,
  statusDetail,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Live timer while streaming reasoning
  useEffect(() => {
    if (!isStreaming) {
      if (reasoningDurationMs) {
        setElapsedMs(reasoningDurationMs);
      } else if (latencyMs) {
        setElapsedMs(latencyMs);
      }
      return;
    }

    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 200);

    return () => clearInterval(interval);
  }, [isStreaming, reasoningDurationMs, latencyMs]);

  // Auto-scroll the reasoning container to bottom as tokens stream in
  useEffect(() => {
    if (isStreaming && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [reasoning, isStreaming]);

  if (!reasoning && !isStreaming) {
    return null;
  }

  const durationStr = formatDuration(
    reasoningDurationMs || latencyMs || (elapsedMs > 0 ? elapsedMs : 1000)
  );

  // While actively streaming reasoning:
  // Render a compact floating scroll panel that auto-follows new tokens
  if (isStreaming) {
    return (
      <div className="reasoning-streaming-container">
        <div className="reasoning-streaming-header">
          <span className="reasoning-pulse-dot" />
          <span className="reasoning-streaming-label">
            {statusDetail || `Thinking... ${durationStr}`}
          </span>
        </div>
        {reasoning ? (
          <div className="reasoning-scroll-panel" ref={scrollContainerRef}>
            <div className="reasoning-text-stream">
              {reasoning}
              <span className="reasoning-cursor" />
            </div>
          </div>
        ) : (
          <div className="reasoning-pre-scroll-hint">
            正在进行深度思维链推理...
          </div>
        )}
      </div>
    );
  }

  // Once finished:
  // Render collapsed button "Worked for <time> ›" matching reference design
  return (
    <div className="reasoning-accordion-container">
      <button
        type="button"
        className="reasoning-toggle-btn"
        onClick={() => setIsExpanded((prev) => !prev)}
        title={isExpanded ? "收起思考过程" : "展开查看完整思考链"}
      >
        <span className="reasoning-toggle-label">Worked for {durationStr}</span>
        <svg
          className={`reasoning-chevron ${isExpanded ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {isExpanded && (
        <div className="reasoning-accordion-content">
          <div className="reasoning-markdown-wrapper">
            <Markdown text={reasoning || ""} />
          </div>
        </div>
      )}
    </div>
  );
};
