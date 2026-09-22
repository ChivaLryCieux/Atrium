import React, { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AiProfile, ChatMessage } from "../types/chat";

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
        total += msg.promptTokens ?? estimateTokens(msg.content);
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
          total += estimateTokens(msg.content);
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

  // Real-time output speed tracking (tokens / second)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null);
  const streamStartRef = useRef<{ time: number } | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      streamStartRef.current = null;
      setLiveSpeed(null);
      return;
    }

    if (!streamStartRef.current) {
      streamStartRef.current = { time: Date.now() };
    }

    const interval = setInterval(() => {
      if (!streamStartRef.current) return;
      const elapsed = (Date.now() - streamStartRef.current.time) / 1000;
      if (elapsed > 0.4) {
        const pendingMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.pending);
        if (pendingMsg) {
          const comp = pendingMsg.completionTokens ?? estimateTokens(pendingMsg.content || "");
          if (comp > 0) {
            setLiveSpeed(Math.round(comp / elapsed));
          }
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [isStreaming, messages]);

  const outputSpeed = useMemo(() => {
    if (isStreaming && liveSpeed !== null && liveSpeed > 0) {
      return liveSpeed;
    }
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
  }, [messages, isStreaming, liveSpeed]);

  return (
    <div
      className={`stage-telemetry-hud ${isStreaming ? "is-streaming" : ""}`}
      title={t("stage.ratioTooltip", {
        current: tokensUsed.toLocaleString(),
        ceiling: ceiling.label,
        percent: percentUsed.toFixed(1),
      })}
    >
      {/* ── Chart 1: 词元使用统计 (Token usage) ── */}
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

      {/* Subtle Horizontal Divider */}
      <div className="telemetry-divider" />

      {/* ── Chart 2: 上下文长度 (Context length circular ring) ── */}
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

      {/* Subtle Horizontal Divider */}
      <div className="telemetry-divider" />

      {/* ── Chart 3: 输出速度 (Output Speed) ── */}
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
    </div>
  );
};

export default StageTelemetryHud;
