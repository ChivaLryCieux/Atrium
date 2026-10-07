import React from "react";
import { useTranslation } from "react-i18next";
import { TokenMetrics } from "../../../types/chat";

interface TokensPanelProps {
  tokenMetrics: TokenMetrics | null;
  onResetTokens: () => void;
}

export const TokensPanel: React.FC<TokensPanelProps> = ({
  tokenMetrics,
  onResetTokens,
}) => {
  const { t } = useTranslation();

  return (
    <div className="settings-tab-pane">
      <div className="pane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="pane-title">{t("settings.tokenStatsTitle")}</h2>
          <p className="pane-subtitle">{t("settings.tokenStatsSubtitle")}</p>
        </div>
        <button
          type="button"
          className="zcode-btn-secondary small"
          onClick={onResetTokens}
          title={t("settings.resetStatsHint")}
        >
          {t("settings.resetStatsBtn")}
        </button>
      </div>

      <div className="stats-metric-grid">
        <div className="metric-card">
          <span className="metric-label">{t("settings.inputTokens")}</span>
          <span className="metric-value">
            {tokenMetrics ? tokenMetrics.totalPromptTokens.toLocaleString() : "0"}
          </span>
          <span className="metric-trend text-success">{t("settings.inputTokensHint")}</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">{t("settings.outputTokens")}</span>
          <span className="metric-value">
            {tokenMetrics ? tokenMetrics.totalCompletionTokens.toLocaleString() : "0"}
          </span>
          <span className="metric-trend text-success">{t("settings.outputTokensHint")}</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">{t("settings.totalRequests")}</span>
          <span className="metric-value">
            {tokenMetrics ? t("common.timesCount", { count: tokenMetrics.totalRequests }) : t("common.timesCount", { count: 0 })}
          </span>
          <span className="metric-trend">{t("settings.totalRequestsHint")}</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">{t("settings.avgLatency")}</span>
          <span className="metric-value">
            {tokenMetrics && tokenMetrics.totalRequests > 0
              ? `${Math.round(tokenMetrics.totalLatencyMs / tokenMetrics.totalRequests)} ms`
              : "0 ms"}
          </span>
          <span className="metric-trend">{t("settings.avgLatencyHint")}</span>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: "20px" }}>
        <div className="list-section-header" style={{ marginBottom: "8px" }}>
          {t("settings.modelBreakdown")}
        </div>
        <div className="models-table">
          <div className="model-row-item header">
            <span>{t("settings.colModel")}</span>
            <span>{t("settings.colInput")}</span>
            <span>{t("settings.colOutput")}</span>
            <span>{t("settings.colCalls")}</span>
            <span>{t("settings.colLatency")}</span>
            <span>{t("settings.colStatus")}</span>
          </div>
          {tokenMetrics && tokenMetrics.models.length > 0 ? (
            tokenMetrics.models.map((m) => (
              <div key={m.modelName} className="model-row-item">
                <span className="model-title">{m.modelName}</span>
                <span>{m.promptTokens.toLocaleString()}</span>
                <span>{m.completionTokens.toLocaleString()}</span>
                <span>{t("common.timesCount", { count: m.requestCount })}</span>
                <span>
                  {m.requestCount > 0
                    ? `${Math.round(m.totalLatencyMs / m.requestCount)} ms`
                    : "-"}
                </span>
                <span className="status-badge active">{t("settings.ready")}</span>
              </div>
            ))
          ) : (
            <div className="model-row-item" style={{ color: "var(--zcode-text-tertiary)", justifyContent: "center", padding: "16px" }}>
              {t("settings.noRecords")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
