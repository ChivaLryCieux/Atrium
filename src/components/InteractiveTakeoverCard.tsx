import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ToolCallItem } from "../types/chat";

export interface InteractiveTakeoverProps {
  toolCall: ToolCallItem;
  onApprove?: (callId: string, outcome: "allowed" | "rejected", note?: string) => void;
  onAnswerQuestion?: (answerText: string) => void;
}

interface ParsedQuestionItem {
  id?: string;
  question: string;
  options: { label: string; description?: string; recommended?: boolean }[];
  isMultiSelect?: boolean;
}

export const InteractiveTakeoverCard: React.FC<InteractiveTakeoverProps> = ({
  toolCall,
  onApprove,
  onAnswerQuestion,
}) => {
  const { t } = useTranslation();

  // Determine if this tool is an interactive question
  const isQuestionTool = useMemo(() => {
    const name = toolCall.name.toLowerCase();
    if (name.includes("question") || name.includes("ask_user") || name.includes("inquire")) {
      return true;
    }
    try {
      const parsed = JSON.parse(toolCall.arguments || "{}");
      return Boolean(parsed.questions || parsed.question);
    } catch {
      return false;
    }
  }, [toolCall.name, toolCall.arguments]);

  // Determine if this tool is a dangerous command requiring approval
  const isDangerousTool = useMemo(() => {
    const name = toolCall.name.toLowerCase();
    return (
      name.includes("run_command") ||
      name.includes("execute_command") ||
      name.includes("shell") ||
      name.includes("exec") ||
      name.includes("delete") ||
      name.includes("remove")
    );
  }, [toolCall.name]);

  // State for Question answering
  const parsedQuestions = useMemo<ParsedQuestionItem[]>(() => {
    if (!isQuestionTool) return [];
    try {
      const parsed = JSON.parse(toolCall.arguments || "{}");
      if (Array.isArray(parsed.questions)) {
        return parsed.questions.map((q: any, idx: number) => {
          const rawOpts: any[] = Array.isArray(q.options) ? q.options : [];
          const options = rawOpts.map((opt) => {
            const labelStr = typeof opt === "string" ? opt : String(opt?.label || "");
            const descStr = typeof opt === "object" ? opt?.description : undefined;
            const isRec =
              typeof opt === "object" && opt?.recommended === true
                ? true
                : /\((?:recommended|推荐)\)/i.test(labelStr);
            return {
              label: labelStr.replace(/\s*\((?:recommended|推荐)\)\s*/i, "").trim(),
              description: descStr,
              recommended: isRec,
            };
          });
          return {
            id: q.id || `q-${idx}`,
            question: q.question || String(q),
            options,
            isMultiSelect: Boolean(q.is_multi_select || q.isMultiSelect),
          };
        });
      } else if (parsed.question) {
        const rawOpts: any[] = Array.isArray(parsed.options) ? parsed.options : [];
        const options = rawOpts.map((opt) => {
          const labelStr = typeof opt === "string" ? opt : String(opt?.label || "");
          const descStr = typeof opt === "object" ? opt?.description : undefined;
          const isRec =
            typeof opt === "object" && opt?.recommended === true
              ? true
              : /\((?:recommended|推荐)\)/i.test(labelStr);
          return {
            label: labelStr.replace(/\s*\((?:recommended|推荐)\)\s*/i, "").trim(),
            description: descStr,
            recommended: isRec,
          };
        });
        return [
          {
            id: "q-single",
            question: parsed.question,
            options,
            isMultiSelect: Boolean(parsed.is_multi_select || parsed.isMultiSelect),
          },
        ];
      }
    } catch {
      // not valid JSON
    }
    return [];
  }, [isQuestionTool, toolCall.arguments]);

  // Selected options state: key = questionId, value = array of selected labels
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const q of parsedQuestions) {
      if (q.id) {
        // Pre-select recommended option if present
        const rec = q.options.find((o) => o.recommended);
        if (rec) {
          initial[q.id] = [rec.label];
        } else {
          initial[q.id] = [];
        }
      }
    }
    return initial;
  });

  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [approvalDecision, setApprovalDecision] = useState<"allowed" | "rejected" | null>(null);

  const handleToggleOption = (qId: string, label: string, isMulti?: boolean) => {
    setSelectedAnswers((prev) => {
      const current = prev[qId] || [];
      if (isMulti) {
        const exists = current.includes(label);
        const next = exists ? current.filter((l) => l !== label) : [...current, label];
        return { ...prev, [qId]: next };
      } else {
        return { ...prev, [qId]: [label] };
      }
    });
  };

  const handleCustomInputChange = (qId: string, val: string) => {
    setCustomInputs((prev) => ({ ...prev, [qId]: val }));
  };

  const handleSubmitQuestionAnswers = () => {
    if (!onAnswerQuestion) return;
    const lines: string[] = [];
    for (const q of parsedQuestions) {
      const qId = q.id || "default";
      const sel = selectedAnswers[qId] || [];
      const custom = (customInputs[qId] || "").trim();
      const combined = [...sel];
      if (custom) {
        combined.push(custom);
      }
      if (combined.length > 0) {
        lines.push(`${q.question}: ${combined.join(", ")}`);
      } else {
        lines.push(`${q.question}: (默认或未作答)`);
      }
    }

    const answerPayload = lines.join("\n");
    setIsSubmitted(true);
    onAnswerQuestion(answerPayload);
  };

  // Approval handlers
  const handleApprove = (outcome: "allowed" | "rejected") => {
    setApprovalDecision(outcome);
    if (onApprove) {
      onApprove(toolCall.id, outcome);
    } else if (onAnswerQuestion) {
      if (outcome === "allowed") {
        onAnswerQuestion(`[操作员审批通过] 允许执行工具: ${toolCall.name}`);
      } else {
        onAnswerQuestion(`[操作员审批驳回] 拒绝执行高危工具: ${toolCall.name}`);
      }
    }
  };

  // If question mode
  if (isQuestionTool && parsedQuestions.length > 0) {
    return (
      <div className={`takeover-card takeover-question ${isSubmitted ? "submitted" : ""}`}>
        <div className="takeover-header">
          <div className="takeover-badge question-badge">
            <span className="takeover-pulse-dot" />
            <span className="takeover-badge-text">{t("takeover.questionBadge")}</span>
          </div>
          <span className="takeover-sub-meta">{toolCall.name}</span>
        </div>

        <div className="takeover-body">
          {parsedQuestions.map((qItem) => {
            const qId = qItem.id || "default";
            const currentSelected = selectedAnswers[qId] || [];
            return (
              <div key={qId} className="takeover-question-block">
                <div className="takeover-question-title font-mono">{qItem.question}</div>
                {qItem.options.length > 0 && (
                  <div className="takeover-options-grid">
                    {qItem.options.map((opt, oIdx) => {
                      const isSelected = currentSelected.includes(opt.label);
                      return (
                        <div
                          key={oIdx}
                          className={`takeover-option-pill ${isSelected ? "selected" : ""}`}
                          onClick={() => !isSubmitted && handleToggleOption(qId, opt.label, qItem.isMultiSelect)}
                        >
                          <div className="takeover-option-indicator">
                            {qItem.isMultiSelect ? (
                              <span className="takeover-checkbox">{isSelected ? "✓" : ""}</span>
                            ) : (
                              <span className="takeover-radio">{isSelected ? "●" : "○"}</span>
                            )}
                          </div>
                          <div className="takeover-option-content">
                            <span className="takeover-option-label">{opt.label}</span>
                            {opt.recommended && (
                              <span className="takeover-rec-tag">{t("takeover.recommended")}</span>
                            )}
                            {opt.description && (
                              <span className="takeover-option-desc">{opt.description}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Freeform answer input */}
                <div className="takeover-custom-input-row">
                  <input
                    type="text"
                    disabled={isSubmitted}
                    placeholder={t("takeover.customAnswerPlaceholder")}
                    className="takeover-input font-mono"
                    value={customInputs[qId] || ""}
                    onChange={(e) => handleCustomInputChange(qId, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isSubmitted) {
                        e.preventDefault();
                        handleSubmitQuestionAnswers();
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="takeover-footer">
          {isSubmitted ? (
            <div className="takeover-submitted-status">
              <span>✓ {t("takeover.submitted")}</span>
            </div>
          ) : (
            <button
              type="button"
              className="takeover-action-btn primary"
              onClick={handleSubmitQuestionAnswers}
            >
              <span>{t("takeover.submitAnswer")}</span>
              <span className="takeover-btn-hint">↵ Enter</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // If dangerous tool requiring operator approval
  if (isDangerousTool && toolCall.status === "running") {
    return (
      <div className={`takeover-card takeover-approval ${approvalDecision ? "decided" : ""}`}>
        <div className="takeover-header warning">
          <div className="takeover-badge warning-badge">
            <span className="takeover-hazard-icon">▲</span>
            <span className="takeover-badge-text">{t("takeover.approvalRequired")}</span>
          </div>
          <span className="takeover-sub-meta font-mono">{toolCall.name}</span>
        </div>

        <div className="takeover-body">
          <div className="takeover-warning-notice">
            {t("takeover.riskNotice")}
          </div>
          <div className="takeover-command-preview font-mono">
            <code>{toolCall.arguments || "No arguments"}</code>
          </div>
        </div>

        <div className="takeover-footer">
          {approvalDecision ? (
            <div className={`takeover-decision-status ${approvalDecision}`}>
              {approvalDecision === "allowed"
                ? `✓ ${t("takeover.allowedNotice")}`
                : `✕ ${t("takeover.rejectedNotice")}`}
            </div>
          ) : (
            <div className="takeover-action-group">
              <button
                type="button"
                className="takeover-action-btn danger"
                onClick={() => handleApprove("rejected")}
              >
                <span>✕ {t("takeover.reject")}</span>
              </button>
              <button
                type="button"
                className="takeover-action-btn success"
                onClick={() => handleApprove("allowed")}
              >
                <span>✓ {t("takeover.allowOnce")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
