import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { ToolCallItem } from "../types/chat";
import { extractDeliverablesFromToolCalls, DeliverableItem } from "../utils/deliverables";

interface DeliverablesPanelProps {
  toolCalls?: ToolCallItem[] | null;
  onOpenFile?: (path: string) => void;
}

export const DeliverablesPanel: React.FC<DeliverablesPanelProps> = ({
  toolCalls,
  onOpenFile,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<boolean>(true);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DeliverableItem | null>(null);

  const deliverables = React.useMemo(() => {
    return extractDeliverablesFromToolCalls(toolCalls);
  }, [toolCalls]);

  if (!deliverables || deliverables.length === 0) {
    return null;
  }

  const handleCopyPath = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1800);
    });
  };

  const handleOpenPath = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (onOpenFile) {
      onOpenFile(path);
      return;
    }
    try {
      await invoke("open_path_in_explorer", { path });
    } catch (err) {
      console.warn("Could not reveal path in explorer:", err);
    }
  };

  const kindBadge = (kind: DeliverableItem["kind"]) => {
    switch (kind) {
      case "created":
        return <span className="deliverable-badge created">{t("deliverable.created")}</span>;
      case "modified":
        return <span className="deliverable-badge modified">{t("deliverable.modified")}</span>;
      case "deleted":
        return <span className="deliverable-badge deleted">{t("deliverable.deleted")}</span>;
      default:
        return <span className="deliverable-badge executed">{t("deliverable.executed")}</span>;
    }
  };

  return (
    <div className="deliverables-panel-container">
      {/* Header bar */}
      <div
        className="deliverables-panel-banner"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="deliverables-banner-left">
          <svg
            className="deliverables-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="deliverables-title">
            {t("deliverable.title")}
          </span>
          <span className="deliverables-count-pill">{deliverables.length}</span>
        </div>

        <div className="deliverables-banner-right">
          <span className="deliverables-chevron">
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

      {/* Deliverable list */}
      {expanded && (
        <div className="deliverables-list">
          {deliverables.map((item) => (
            <div
              key={item.id}
              className={`deliverable-card ${selectedItem?.id === item.id ? "selected" : ""}`}
              onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
            >
              <div className="deliverable-card-row">
                <div className="deliverable-info">
                  {kindBadge(item.kind)}
                  <span className="deliverable-filename" title={item.path}>
                    {item.filename}
                  </span>
                  <span className="deliverable-path" title={item.path}>
                    {item.path}
                  </span>
                </div>

                <div className="deliverable-actions">
                  <button
                    type="button"
                    className="deliverable-action-btn"
                    title={t("deliverable.copyPath")}
                    onClick={(e) => handleCopyPath(e, item.path)}
                  >
                    {copiedPath === item.path ? (
                      <span className="deliverable-action-text">{t("tool.copied")}</span>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>

                  <button
                    type="button"
                    className="deliverable-action-btn"
                    title={t("deliverable.openInExplorer")}
                    onClick={(e) => handleOpenPath(e, item.path)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Expandable diff / snippet inspector */}
              {selectedItem?.id === item.id && (
                <div className="deliverable-detail-view" onClick={(e) => e.stopPropagation()}>
                  {item.diffSummary && (
                    <div className="deliverable-diff-block">
                      {item.diffSummary.oldString && (
                        <div className="diff-chunk removal">
                          <span className="diff-gutter">-</span>
                          <pre className="diff-code">{item.diffSummary.oldString}</pre>
                        </div>
                      )}
                      {item.diffSummary.newString && (
                        <div className="diff-chunk addition">
                          <span className="diff-gutter">+</span>
                          <pre className="diff-code">{item.diffSummary.newString}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  {item.contentSnippet && !item.diffSummary && (
                    <div className="deliverable-snippet-block">
                      <div className="snippet-header">{t("deliverable.previewSnippet")}</div>
                      <pre className="snippet-code">{item.contentSnippet}</pre>
                    </div>
                  )}

                  <div className="deliverable-meta-row">
                    <span className="deliverable-meta-tag">
                      {t("deliverable.producer")}: {item.toolName}
                    </span>
                    <span className="deliverable-meta-tag biolinum-figure">
                      {new Date(item.timestamp || Date.now()).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
