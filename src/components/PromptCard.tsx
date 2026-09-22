import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiProfile, ExecutionMode, ReasoningEffort, Soul } from "../types/chat";

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

type ProviderModelDropdownProps = {
  profiles: AiProfile[];
  activeProfileId: string | null;
  selectedModel: string;
  onSelect: (profileId: string, modelName: string) => void;
};

/// Two-level model picker: left column lists providers, hovering a
/// provider (VS Code style) opens its model list in the right column;
/// clicking a model selects the (provider, model) pair at once.
function ProviderModelDropdown({ profiles, activeProfileId, selectedModel, onSelect }: ProviderModelDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hoverProfileId, setHoverProfileId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const nonEmpty = profiles.filter((p) => p.models.some((m) => m.name.trim()));
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  const hovered = profiles.find((p) => p.id === hoverProfileId) ?? active;
  const label = selectedModel || active?.model || t("prompt.model");

  return (
    <div className="pill-dropdown" ref={ref}>
      <button
        type="button"
        className="pill-dropdown-btn"
        title={active ? `${active.name} / ${label}` : label}
        onClick={() => {
          setHoverProfileId(active?.id ?? null);
          setOpen((prev) => !prev);
        }}
      >
        <span>{label}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="provider-model-menu">
          <div className="pill-dropdown-header">{t("prompt.model")}</div>
          {nonEmpty.length === 0 && <div className="pill-dropdown-empty">{t("prompt.noProviders")}</div>}
          {nonEmpty.length > 0 && (
            <div className="provider-model-columns">
              <div className="provider-model-providers">
                {nonEmpty.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onMouseEnter={() => setHoverProfileId(profile.id)}
                    onFocus={() => setHoverProfileId(profile.id)}
                    onClick={() => setHoverProfileId(profile.id)}
                    className={`pill-dropdown-item provider-row ${profile.id === hovered?.id ? "hovered" : ""} ${
                      profile.id === active?.id ? "active-provider" : ""
                    }`}
                    title={profile.description || profile.endpoint}
                  >
                    <span className="provider-row-avatar">{profile.avatar}</span>
                    <span className="provider-row-name">{profile.name}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                ))}
              </div>
              <div className="provider-model-models">
                {(hovered?.models ?? []).filter((m) => m.name.trim()).map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => {
                      if (hovered) onSelect(hovered.id, m.name);
                      setOpen(false);
                    }}
                    className={`pill-dropdown-item ${
                      hovered && active && hovered.id === active.id && m.name === selectedModel ? "active" : ""
                    }`}
                  >
                    <span>{m.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type PromptCardProps = {
  projectName?: string;
  projectTooltip?: string;
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  isSending: boolean;
  souls: Soul[];
  activeSoul: string | null;
  onActivateSoul: (folder: string) => void;
  profiles: AiProfile[];
  activeProfileId: string | null;
  selectedModel: string;
  onSelectModel: (profileId: string, modelName: string) => void;
  reasoningEffort: ReasoningEffort;
  onSelectReasoningEffort: (effort: ReasoningEffort) => void;
  executionMode: ExecutionMode;
  onSelectExecutionMode: (mode: ExecutionMode) => void;
};

export function PromptCard({
  placeholder,
  draft,
  setDraft,
  onSend,
  isSending,
  souls,
  activeSoul,
  onActivateSoul,
  profiles,
  activeProfileId,
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
  const soulItems: DropdownItem[] = souls.map((s) => ({ key: s.folder, label: s.name }));

  return (
    <div className="prompt-card">
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
          <ProviderModelDropdown
            profiles={profiles}
            activeProfileId={activeProfileId}
            selectedModel={selectedModel}
            onSelect={onSelectModel}
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
