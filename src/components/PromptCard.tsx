import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExecutionMode, ProviderModel, ReasoningEffort, Soul } from "../types/chat";

type DropdownItem = { key: string; label: string; description?: string };

type PillDropdownProps = {
  header: string;
  label: string;
  items: DropdownItem[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  emptyHint?: string;
};

function PillDropdown({ header, label, items, selectedKey, onSelect, emptyHint }: PillDropdownProps) {
  const { t } = useTranslation();
  const noOptions = t("prompt.noOptions");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="pill-dropdown" ref={ref}>
      <button type="button" className="pill-dropdown-btn" onClick={() => setOpen((prev) => !prev)}>
        <span>{label}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="pill-dropdown-menu">
          <div className="pill-dropdown-header">{header}</div>
          {items.length === 0 && <div className="pill-dropdown-empty">{emptyHint ?? noOptions}</div>}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pill-dropdown-item ${item.key === selectedKey ? "active" : ""}`}
              title={item.description}
              onClick={() => {
                onSelect(item.key);
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              {item.key === selectedKey && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type PromptCardProps = {
  projectName: string;
  projectTooltip?: string;
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  isSending: boolean;
  souls: Soul[];
  activeSoul: string | null;
  onActivateSoul: (folder: string) => void;
  models: ProviderModel[];
  selectedModel: string;
  onSelectModel: (name: string) => void;
  reasoningEffort: ReasoningEffort;
  onSelectReasoningEffort: (effort: ReasoningEffort) => void;
  executionMode: ExecutionMode;
  onSelectExecutionMode: (mode: ExecutionMode) => void;
};

export function PromptCard({
  projectName,
  projectTooltip,
  placeholder,
  draft,
  setDraft,
  onSend,
  isSending,
  souls,
  activeSoul,
  onActivateSoul,
  models,
  selectedModel,
  onSelectModel,
  reasoningEffort,
  onSelectReasoningEffort,
  executionMode,
  onSelectExecutionMode,
}: PromptCardProps) {
  const { t } = useTranslation();
  const EFFORT_OPTIONS: { key: ReasoningEffort; label: string }[] = [
    { key: "max", label: t("prompt.maxReasoning") },
    { key: "high", label: t("prompt.highReasoning") },
    { key: "low", label: t("prompt.lowReasoning") },
  ];

  const EXECUTION_MODE_OPTIONS: { key: ExecutionMode; label: string; description: string }[] = [
    { key: "plan", label: t("prompt.planMode"), description: t("prompt.planModeDesc") },
    { key: "ask", label: t("prompt.askMode"), description: t("prompt.askModeDesc") },
    { key: "auto", label: t("prompt.autoMode"), description: t("prompt.autoModeDesc") },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !isSending) onSend();
    }
  };

  const activeSoulName = souls.find((s) => s.folder === activeSoul)?.name ?? t("prompt.defaultSoul");
  const modelItems: DropdownItem[] = models
    .filter((m) => m.name.trim())
    .map((m) => ({ key: m.name, label: m.name }));
  const soulItems: DropdownItem[] = souls.map((s) => ({ key: s.folder, label: s.name }));

  return (
    <div className="prompt-card">
      {/* Header: static project name */}
      <div className="prompt-card-header">
        <span className="project-label" title={projectTooltip}>
          <span>{projectName}</span>
        </span>
      </div>

      {/* Text Input Area */}
      <textarea
        className="prompt-textarea"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />

      {/* Bottom Actions Bar: soul / model / effort — send */}
      <div className="prompt-card-footer">
        <div className="footer-left-controls">
          <PillDropdown
            header={t("prompt.soul")}
            label={activeSoulName}
            items={soulItems}
            selectedKey={activeSoul}
            onSelect={onActivateSoul}
            emptyHint={t("prompt.noSouls")}
          />
          <PillDropdown
            header={t("prompt.model")}
            label={selectedModel || t("prompt.model")}
            items={modelItems}
            selectedKey={selectedModel}
            onSelect={onSelectModel}
            emptyHint={t("prompt.noModels")}
          />
          <PillDropdown
            header={t("prompt.reasoning")}
            label={EFFORT_OPTIONS.find((o) => o.key === reasoningEffort)?.label ?? t("prompt.standard")}
            items={EFFORT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
            selectedKey={reasoningEffort}
            onSelect={(key) => onSelectReasoningEffort(key as ReasoningEffort)}
          />
          <PillDropdown
            header={t("prompt.execution")}
            label={EXECUTION_MODE_OPTIONS.find((o) => o.key === executionMode)?.label ?? t("prompt.askMode")}
            items={EXECUTION_MODE_OPTIONS.map((o) => ({ key: o.key, label: o.label, description: o.description }))}
            selectedKey={executionMode}
            onSelect={(key) => onSelectExecutionMode(key as ExecutionMode)}
          />
        </div>

        <div className="footer-right-controls">
          <button
            type="button"
            className="send-arrow-btn"
            disabled={!draft.trim() || isSending}
            onClick={onSend}
            title={t("prompt.send")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="19" x2="12" y2="5" strokeLinecap="round" />
              <polyline points="5 12 12 5 19 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
