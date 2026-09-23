import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolCallItem } from "../types/chat";

interface ToolCallTerminalProps {
  toolCalls?: ToolCallItem[] | null;
}

export const ToolCallTerminal: React.FC<ToolCallTerminalProps> = ({ toolCalls }) => {
  const { t } = useTranslation();
  // 列表级收纳状态。hooks 必须早于空数据豁免，故置于 return null 之前。
  const [manualListOverride, setManualListOverride] = useState<boolean | null>(null);

  const hasRunning = (toolCalls ?? []).some((c) => c.status === "running");

  // 轮次重新开工（running 状态复现）时收回手动覆盖，让列表跟随自动规则。
  React.useEffect(() => {
    if (hasRunning) {
      setManualListOverride(null);
    }
  }, [hasRunning]);

  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  // 自动规则：执行中展开（配合「跟随活跃调用」实时呈现细节），
  // 全部结束后收纳——从历史加载的消息挂起即已是终态，默认也是收纳的。
  const listExpanded = manualListOverride ?? hasRunning;
  const toggleList = () => setManualListOverride((prev) => !(prev ?? hasRunning));

  return (
    <div className="tool-call-terminal-container">
      <div
        className="tool-call-terminal-banner"
        role="button"
        tabIndex={0}
        aria-expanded={listExpanded}
        title={listExpanded ? t("tool.collapse") : t("tool.expand")}
        onClick={toggleList}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleList();
          }
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span className="tool-terminal-title">{t("tool.title")} ({toolCalls.length})</span>
        {hasRunning && (
          <span className="tool-status-pill running">
            <span className="tool-spinner-dot" />
            <span className="tool-status-text">{t("tool.running")}</span>
          </span>
        )}
        <span className="tool-list-chevron">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: listExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {listExpanded && (
        <div className="tool-call-list">
          {toolCalls.map((call, idx) => (
            <ToolCallCard
              key={call.id || `tool-${idx}`}
              item={call}
              autoExpanded={hasRunning && idx === toolCalls.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ToolCallCardProps {
  item: ToolCallItem;
  /// Container-driven follow-the-active-call target: true only for the
  /// newest call while the turn is still working. The card follows this
  /// until the operator manually toggles it — from then on the manual
  /// choice wins (so a card opened after the turn settled stays open).
  autoExpanded?: boolean;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ item, autoExpanded = false }) => {
  const { t } = useTranslation();
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const [copiedArgs, setCopiedArgs] = useState<boolean>(false);
  const [copiedOutput, setCopiedOutput] = useState<boolean>(false);

  // The follow target moving onto this card re-asserts the auto state
  // (a newer call taking over, or a fresh turn starting).
  React.useEffect(() => {
    if (autoExpanded) {
      setManualOverride(null);
    }
  }, [autoExpanded]);

  const expanded = manualOverride ?? autoExpanded;
  const toggleExpanded = () => setManualOverride((prev) => !(prev ?? autoExpanded));

  const handleCopyArgs = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.arguments) return;
    navigator.clipboard.writeText(item.arguments).then(() => {
      setCopiedArgs(true);
      setTimeout(() => setCopiedArgs(false), 2000);
    });
  };

  const handleCopyOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = item.result || item.error || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    });
  };

  // Format arguments if JSON
  const formattedArgs = React.useMemo(() => {
    if (!item.arguments) return "";
    try {
      const parsed = JSON.parse(item.arguments);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return item.arguments;
    }
  }, [item.arguments]);

  return (
    <div className={`tool-call-card ${item.status}`}>
      {/* Header bar */}
      <div
        className="tool-call-header"
        onClick={toggleExpanded}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            toggleExpanded();
          }
        }}
      >
        <div className="tool-call-meta">
          <span className="tool-prompt-sym">&gt;</span>
          <span className="tool-name">{item.name}</span>
          {item.step !== undefined && (
            <span className="tool-step-tag">#{item.step}</span>
          )}
        </div>

        <div className="tool-call-status-zone">
          <span className={`tool-status-pill ${item.status}`}>
            {item.status === "running" && (
              <span className="tool-spinner-dot" />
            )}
            {item.status === "completed" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {item.status === "error" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            <span className="tool-status-text">
              {item.status === "running"
                ? t("tool.running")
                : item.status === "error"
                ? t("tool.error")
                : t("tool.completed")}
            </span>
          </span>

          <span className="tool-chevron-icon">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {/* Expanded terminal body */}
      {expanded && (
        <div className="tool-call-body">
          {formattedArgs && (
            <div className="tool-section tool-section-args">
              <div className="tool-section-head">
                <span className="tool-section-label">{t("tool.args")}</span>
                <button
                  type="button"
                  className="tool-copy-btn"
                  onClick={handleCopyArgs}
                  title={copiedArgs ? t("tool.copied") : t("tool.copy")}
                >
                  {copiedArgs ? t("tool.copied") : t("tool.copy")}
                </button>
              </div>
              <pre className="tool-code-block font-mono">
                <code>{formattedArgs}</code>
              </pre>
            </div>
          )}

          <div className="tool-section tool-section-output">
            <div className="tool-section-head">
              <span className="tool-section-label">{t("tool.output")}</span>
              {(item.result || item.error) && (
                <button
                  type="button"
                  className="tool-copy-btn"
                  onClick={handleCopyOutput}
                  title={copiedOutput ? t("tool.copied") : t("tool.copy")}
                >
                  {copiedOutput ? t("tool.copied") : t("tool.copy")}
                </button>
              )}
            </div>

            <div className="tool-terminal-window font-mono">
              {item.status === "running" && !item.result && !item.error && (
                <div className="tool-output-running">
                  <span className="tool-cursor">▌</span>
                  <span>{t("tool.running")}</span>
                </div>
              )}

              {item.error && (
                <div className="tool-output-error">
                  {item.error}
                </div>
              )}

              {item.result && (
                <pre className="tool-output-content">
                  {item.result}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
