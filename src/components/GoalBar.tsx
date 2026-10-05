import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface GoalBarProps {
  goalText?: string | null;
  onUpdateGoal?: (newGoal: string) => void;
  onClearGoal?: () => void;
  isStreaming?: boolean;
}

export const GoalBar: React.FC<GoalBarProps> = ({
  goalText,
  onUpdateGoal,
  onClearGoal,
  isStreaming = false,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(goalText || "");
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  useEffect(() => {
    setDraft(goalText || "");
  }, [goalText]);

  if (!goalText || goalText.trim().length === 0) {
    return null;
  }

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && onUpdateGoal) {
      onUpdateGoal(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setDraft(goalText || "");
      setIsEditing(false);
    }
  };

  return (
    <div className={`goal-bar-dock ${isStreaming ? "is-active" : ""}`}>
      <div className="goal-bar-inner">
        {/* Left icon & tag */}
        <div className="goal-badge-group">
          <span className="goal-target-icon" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </span>
          <span className="goal-badge-label">
            {t("goal.objective")}
          </span>
          {isStreaming && (
            <span className="goal-active-pulse" title={t("goal.inProgress")}>
              <span className="goal-pulse-dot" />
            </span>
          )}
        </div>

        {/* Center: Goal text or editor */}
        <div className="goal-content-area">
          {isEditing ? (
            <input
              type="text"
              className="goal-inline-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              autoFocus
              placeholder={t("goal.placeholder")}
            />
          ) : (
            <span
              className={`goal-text-display ${isCollapsed ? "collapsed" : ""}`}
              title={goalText}
              onClick={() => setIsEditing(true)}
            >
              {goalText}
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="goal-actions-group">
          {!isEditing ? (
            <>
              <button
                type="button"
                className="goal-icon-btn"
                title={t("goal.edit")}
                onClick={() => setIsEditing(true)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>

              <button
                type="button"
                className="goal-icon-btn"
                title={isCollapsed ? t("goal.expand") : t("goal.collapse")}
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{
                    transform: isCollapsed ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.18s ease",
                  }}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>

              {onClearGoal && (
                <button
                  type="button"
                  className="goal-icon-btn danger"
                  title={t("goal.clear")}
                  onClick={onClearGoal}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="goal-save-btn"
              onClick={handleSave}
            >
              {t("goal.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
