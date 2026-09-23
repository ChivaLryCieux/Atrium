import React, { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AiProfile, ChatMessage } from "../types/chat";
import { StarModelViewer } from "./StarModelViewer";

/**
 * Fast, accurate BPE & CJK token estimator mirroring the backend tokens.rs.
 * Accurately tracks token usage without heavy tokenizer dependencies.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let count = 0;
  let asciiWordChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ASCII character
    if (code <= 127) {
      const isAlphanumeric =
        (code >= 48 && code <= 57) || // 0-9
        (code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122); // a-z
      if (isAlphanumeric) {
        asciiWordChars++;
      } else {
        if (asciiWordChars > 0) {
          count += Math.floor((asciiWordChars + 3) / 4);
          asciiWordChars = 0;
        }
        // Non-whitespace ASCII punctuation counts as 1 token
        const isWhitespace = code === 32 || code === 9 || code === 10 || code === 13;
        if (!isWhitespace) {
          count++;
        }
      }
    } else {
      // Non-ASCII (CJK, emoji, unicode symbols)
      if (asciiWordChars > 0) {
        count += Math.floor((asciiWordChars + 3) / 4);
        asciiWordChars = 0;
      }
      // CJK characters count as 1 to 1.5 tokens
      count++;
    }
  }

  if (asciiWordChars > 0) {
    count += Math.floor((asciiWordChars + 3) / 4);
  }

  return Math.max(count, 1);
}

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, number>();

export function estimateTokensCached(text: string): number {
  if (!text) return 0;
  if (text.length > 50000) {
    return estimateTokens(text);
  }
  const cached = tokenCache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const val = estimateTokens(text);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const iter = tokenCache.keys();
    for (let i = 0; i < Math.floor(TOKEN_CACHE_MAX / 2); i++) {
      const next = iter.next();
      if (next.done) break;
      tokenCache.delete(next.value);
    }
  }
  tokenCache.set(text, val);
  return val;
}

/**
 * Resolves the ceiling context window for the active model.
 * Atrium models use 256K (256,000) or 1M (1,000,000).
 */
export function resolveContextCeiling(
  modelName: string | undefined,
  activeProfile: AiProfile | null
): { value: number; label: string } {
  const model = activeProfile?.models?.find(
    (m) => m.name === modelName || m.id === modelName
  );

  const rawLength = model?.contextLength;
  if (rawLength && Number(rawLength) >= 500000) {
    return { value: 1000000, label: "1M" };
  }

  return { value: 256000, label: "256K" };
}

/**
 * Format context tokens for the gauge ratio display (e.g. 12K, 20K, 256K, 1M).
 */
export function formatContextTokens(tokens: number): string {
  if (tokens <= 0) return "0";
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) {
    const k = tokens / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  if (tokens < 1000000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  const m = tokens / 1000000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
}

export interface StageTelemetryHudProps {
  messages: ChatMessage[];
  selectedModel: string;
  activeProfile: AiProfile | null;
  isStreaming?: boolean;
}

export const StageTelemetryHud: React.FC<StageTelemetryHudProps> = ({
  messages,
  selectedModel,
  activeProfile,
  isStreaming = false,
}) => {
  const { t } = useTranslation();

  // Calculate total cumulative tokens used across the entire task in real-time.
  // Prioritize exact tokens returned by the API/kernel (promptTokens + completionTokens),
  // falling back to text estimation only when API token metrics are not yet recorded.
  const tokensUsed = useMemo(() => {
    let total = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        // User messages are part of the prompt context
        total += msg.promptTokens ?? estimateTokensCached(msg.content);
      } else if (msg.role === "assistant") {
        const hasPrompt = typeof msg.promptTokens === "number" && msg.promptTokens > 0;
        const hasCompletion = typeof msg.completionTokens === "number" && msg.completionTokens > 0;

        if (hasPrompt || hasCompletion) {
          // Exact token metric recorded from API turn
          total += (msg.promptTokens ?? 0) + (msg.completionTokens ?? 0);
        } else if (msg.content) {
          // Fallback during streaming or for legacy messages
          if (
            msg.pending &&
            (msg.content === t("app.thinking") ||
              msg.content.includes(t("app.stageAnalyzing")))
          ) {
            continue;
          }
          total += msg.pending ? estimateTokens(msg.content) : estimateTokensCached(msg.content);
        }
      }
    }
    return Math.max(total, 1);
  }, [messages, t]);

  const ceiling = useMemo(
    () => resolveContextCeiling(selectedModel, activeProfile),
    [selectedModel, activeProfile]
  );

  // Percentage of context window used
  const percentUsed = Math.min(100, Math.max(0, (tokensUsed / ceiling.value) * 100));

  // SVG Circular Gauge calculations
  // Outer size: 92px x 92px. Center (46, 46). Radius r = 38.
  // Circumference: 2 * Math.PI * 38 ≈ 238.761
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, tokensUsed / ceiling.value);
  const strokeDashoffset = circumference * (1 - progress);

  // Status color for the circular ring based on usage pressure
  const ringColor =
    percentUsed >= 90
      ? "var(--accent-danger, #ef4444)"
      : percentUsed >= 75
      ? "#f59e0b"
      : "var(--text-primary, #18181b)";

  // Cumulative average output speed tracking: Total completion tokens / Total inference time (seconds)
  const [streamElapsedSec, setStreamElapsedSec] = useState<number>(0);
  const streamStartRef = useRef<{ time: number } | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      streamStartRef.current = null;
      setStreamElapsedSec(0);
      return;
    }

    if (!streamStartRef.current) {
      streamStartRef.current = { time: Date.now() };
    }

    const interval = setInterval(() => {
      if (!streamStartRef.current) return;
      const elapsed = (Date.now() - streamStartRef.current.time) / 1000;
      setStreamElapsedSec(elapsed);
    }, 200);

    return () => clearInterval(interval);
  }, [isStreaming]);

  const outputSpeed = useMemo(() => {
    let totalCompletionTokens = 0;
    let totalDurationSec = 0;

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;

      if (msg.pending) {
        const comp = msg.completionTokens ?? (msg.content ? estimateTokens(msg.content) : 0);
        if (comp > 0) {
          totalCompletionTokens += comp;
        }
      } else {
        const comp = msg.completionTokens ?? (msg.content ? estimateTokensCached(msg.content) : 0);
        const lat =
          msg.latencyMs && msg.latencyMs > 0
            ? msg.latencyMs / 1000
            : msg.reasoningDurationMs && msg.reasoningDurationMs > 0
            ? msg.reasoningDurationMs / 1000
            : 0;

        if (comp > 0) {
          totalCompletionTokens += comp;
          if (lat > 0) {
            totalDurationSec += lat;
          }
        }
      }
    }

    // Include ongoing streaming turn elapsed time
    if (isStreaming && streamElapsedSec > 0.4) {
      totalDurationSec += streamElapsedSec;
    }

    if (totalDurationSec > 0 && totalCompletionTokens > 0) {
      return Math.round(totalCompletionTokens / totalDurationSec);
    }

    // Fallback: check the latest assistant turn with recorded latency
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && !msg.pending) {
        if (msg.completionTokens && msg.latencyMs && msg.latencyMs > 0) {
          const s = Math.round(msg.completionTokens / (msg.latencyMs / 1000));
          if (s > 0) return s;
        }
      }
    }

    return 0;
  }, [messages, isStreaming, streamElapsedSec]);

  const isNewChat = messages.length === 0;

  // HUD Display States:
  // "default": 3 slots (Tokens, Context Gauge, Star)
  // "expanded": 3 slots + Extended stats (Average output speed)
  // "minimal": Panel background disappears, Slots 1 & 2 collapse, Star glides up to the top-right
  const [displayState, setDisplayState] = useState<"default" | "expanded" | "minimal">(
    isNewChat ? "minimal" : "default"
  );
  const [spinTrigger, setSpinTrigger] = useState<number>(0);
  const prevMessagesLenRef = useRef<number>(messages.length);

  // When user initiates a conversation from new chat page, automatically expand into default state!
  useEffect(() => {
    if (prevMessagesLenRef.current === 0 && messages.length > 0) {
      setDisplayState("default");
      setSpinTrigger((prev) => prev + 1);
    } else if (messages.length === 0 && prevMessagesLenRef.current > 0) {
      setDisplayState("minimal");
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages.length]);

  const cycleDisplayState = () => {
    if (isNewChat) return; // In new chat page, Star is not clickable and data panel will not expand
    setSpinTrigger((prev) => prev + 1);
    setDisplayState((prev) => {
      if (prev === "default") return "expanded";
      if (prev === "expanded") return "minimal";
      return "default";
    });
  };

  const starTooltip = useMemo(() => {
    if (isNewChat) return undefined;
    if (displayState === "default") return t("stage.clickToExpand");
    if (displayState === "expanded") return t("stage.clickToMinimize");
    return t("stage.clickToRestore");
  }, [displayState, isNewChat, t]);

  return (
    <div
      className={`stage-telemetry-hud state-${displayState} ${isNewChat ? "is-new-chat" : ""} ${isStreaming ? "is-streaming" : ""}`}
      title={
        isNewChat
          ? undefined
          : displayState === "minimal"
          ? starTooltip
          : t("stage.ratioTooltip", {
              current: tokensUsed.toLocaleString(),
              ceiling: ceiling.label,
              percent: percentUsed.toFixed(1),
            })
      }
    >
      {/* ── Chart 1: 词元使用统计 (Token usage) ── */}
      <div className="telemetry-collapsible-item telemetry-slot-1">
        <div className="telemetry-chart telemetry-tokens-chart">
          <div className="telemetry-header">
            <span className="telemetry-label">{t("stage.tokensUsed")}</span>
          </div>
          <div
            className="telemetry-big-number biolinum-figure"
            title={`${tokensUsed.toLocaleString()} tokens`}
          >
            {tokensUsed.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Subtle Horizontal Divider 1 */}
      <div className="telemetry-collapsible-item telemetry-divider-slot">
        <div className="telemetry-divider" />
      </div>

      {/* ── Chart 2: 上下文长度 (Context length circular ring) ── */}
      <div className="telemetry-collapsible-item telemetry-slot-2">
        <div className="telemetry-chart telemetry-context-chart">
          <div className="telemetry-header">
            <span className="telemetry-label">{t("stage.contextLength")}</span>
          </div>
          <div className="telemetry-gauge-container">
            <svg
              className="telemetry-circular-gauge"
              width="92"
              height="92"
              viewBox="0 0 92 92"
            >
              {/* Background track circle */}
              <circle
                className="gauge-bg-circle"
                cx="46"
                cy="46"
                r={radius}
                strokeWidth="7"
              />
              {/* Active progress ring */}
              <circle
                className="gauge-progress-circle"
                cx="46"
                cy="46"
                r={radius}
                strokeWidth="7"
                stroke={ringColor}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 46 46)"
              />
            </svg>

            {/* Centered Ratio Text inside the Ring */}
            <div className="gauge-inner-text">
              <span className="gauge-current-val biolinum-figure">
                {formatContextTokens(tokensUsed)}
              </span>
              <span className="gauge-divider-ceiling">
                /{ceiling.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle Horizontal Divider 2 */}
      <div className="telemetry-collapsible-item telemetry-divider-slot">
        <div className="telemetry-divider" />
      </div>

      {/* ── Chart 3: 更多统计数据 (Interactive Star 3D Model) ── */}
      <div
        className={`telemetry-chart telemetry-star-chart state-${displayState} ${isNewChat ? "is-new-chat-star" : ""}`}
        onClick={isNewChat ? undefined : cycleDisplayState}
        role={isNewChat ? undefined : "button"}
        tabIndex={isNewChat ? undefined : 0}
        onKeyDown={(e) => {
          if (!isNewChat && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            cycleDisplayState();
          }
        }}
        title={starTooltip}
      >
        <div className="telemetry-header telemetry-interactive-header telemetry-collapsible-header">
          <span className="telemetry-label">{t("stage.moreStats")}</span>
          <svg
            className={`telemetry-expand-chevron ${displayState === "expanded" ? "is-expanded" : ""}`}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </div>
        <div className="telemetry-star-wrapper">
          <StarModelViewer
            isRotating={isStreaming || messages.some((m) => m.pending)}
            spinTrigger={spinTrigger}
            slowSpin={isNewChat}
          />
        </div>
      </div>

      {/* ── Extended Metrics Section (revealed in "expanded" state) ── */}
      <div className={`telemetry-extended-container ${displayState === "expanded" ? "is-open" : ""}`}>
        {/* Subtle Horizontal Divider */}
        <div className="telemetry-divider" />

        {/* ── Metric: 平均输出速度 (Average Output Speed) ── */}
        <div className="telemetry-chart telemetry-speed-chart">
          <div className="telemetry-header">
            <span className="telemetry-label">{t("stage.outputSpeed")}</span>
          </div>
          <div
            className="telemetry-big-number biolinum-figure"
            title={`${outputSpeed > 0 ? outputSpeed : 0} ${t("stage.tokensPerSec")}`}
          >
            {outputSpeed > 0 ? outputSpeed.toLocaleString() : (isStreaming ? "..." : "-")}
          </div>
          <div className="telemetry-unit-label">
            {t("stage.tokensPerSec")}
          </div>
        </div>

        {/* Subsequent additional metrics can be placed here seamlessly */}
      </div>
    </div>
  );
};

export default StageTelemetryHud;
