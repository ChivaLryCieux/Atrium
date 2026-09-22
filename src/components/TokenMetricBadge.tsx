import React from "react";
import { useTranslation } from "react-i18next";

interface TokenMetricBadgeProps {
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
}

export const TokenMetricBadge: React.FC<TokenMetricBadgeProps> = ({
  promptTokens,
  completionTokens,
  latencyMs,
}) => {
  const { t } = useTranslation();

  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  const total = prompt + completion;

  if (total <= 0 && (!latencyMs || latencyMs <= 0)) {
    return null;
  }

  const speed =
    latencyMs && latencyMs > 0 && completion > 0
      ? (completion / (latencyMs / 1000)).toFixed(1)
      : null;

  const latencyStr =
    latencyMs && latencyMs > 0
      ? latencyMs >= 1000
        ? `${(latencyMs / 1000).toFixed(2)}s`
        : `${latencyMs}ms`
      : null;

  const promptPercent = total > 0 ? Math.round((prompt / total) * 100) : 50;

  return (
    <div className="token-metric-badge" title={t("token.metricTitle")}>
      <div className="token-metric-chips">
        <span className="token-chip prompt-chip" title={`${t("token.input")}: ${prompt.toLocaleString()}`}>
          <span className="token-chip-sym">↑</span>
          <span className="token-chip-label">{t("token.input")}</span>
          <span className="token-chip-val font-mono">{prompt.toLocaleString()}</span>
        </span>

        <span className="token-chip completion-chip" title={`${t("token.output")}: ${completion.toLocaleString()}`}>
          <span className="token-chip-sym">↓</span>
          <span className="token-chip-label">{t("token.output")}</span>
          <span className="token-chip-val font-mono">{completion.toLocaleString()}</span>
        </span>

        <span className="token-chip total-chip" title={`${t("token.total")}: ${total.toLocaleString()}`}>
          <span className="token-chip-sym">∑</span>
          <span className="token-chip-label">{t("token.total")}</span>
          <span className="token-chip-val font-mono">{total.toLocaleString()}</span>
        </span>

        {speed && (
          <span className="token-chip speed-chip" title={`${t("token.speed")}: ${t("token.tokensPerSec", { speed })}`}>
            <span className="token-chip-sym">⚡</span>
            <span className="token-chip-val font-mono">{t("token.tokensPerSec", { speed })}</span>
          </span>
        )}

        {latencyStr && (
          <span className="token-chip latency-chip" title={`${t("token.latency")}: ${latencyStr}`}>
            <span className="token-chip-sym">⏱</span>
            <span className="token-chip-val font-mono">{latencyStr}</span>
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="token-ratio-bar" title={`${promptPercent}% ${t("token.input")} / ${100 - promptPercent}% ${t("token.output")}`}>
          <div
            className="token-ratio-prompt"
            style={{ width: `${promptPercent}%` }}
          />
          <div
            className="token-ratio-completion"
            style={{ width: `${100 - promptPercent}%` }}
          />
        </div>
      )}
    </div>
  );
};
