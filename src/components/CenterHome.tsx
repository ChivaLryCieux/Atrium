import React from "react";
import { useTranslation } from "react-i18next";
import { AiProfile, ExecutionMode, Project, ReasoningEffort, Soul } from "../types/chat";
import { PromptCard } from "./PromptCard";
import TextType from "./TextType";

type CenterHomeProps = {
  draft: string;
  setDraft: (val: string) => void;
  onSend: () => void;
  isSending: boolean;
  activeProject: Project | null;
  fallbackProjectName: string;
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

export function CenterHome({
  draft,
  setDraft,
  onSend,
  isSending,
  activeProject,
  fallbackProjectName,
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
}: CenterHomeProps) {
  const { t } = useTranslation();
  const greetings = [
    t("home.greeting"),
    t("home.greetingEn"),
  ];

  return (
    <div className="center-home">
      {/* Greeting Heading with TextType dynamic effect */}
      <TextType
        as="h1"
        className="greeting-text"
        text={greetings}
        typingSpeed={85}
        pauseDuration={3800}
        deletingSpeed={35}
        variableSpeed={{ min: 60, max: 110 }}
        showCursor={true}
        cursorCharacter="_"
        cursorBlinkDuration={0.6}
        loop={true}
      />

      <PromptCard
        projectName={activeProject?.name?.trim() || fallbackProjectName}
        projectTooltip={activeProject?.description || activeProject?.defaultDirectory || undefined}
        placeholder={t("home.placeholder")}
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        isSending={isSending}
        souls={souls}
        activeSoul={activeSoul}
        onActivateSoul={onActivateSoul}
        profiles={profiles}
        activeProfileId={activeProfileId}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        reasoningEffort={reasoningEffort}
        onSelectReasoningEffort={onSelectReasoningEffort}
        executionMode={executionMode}
        onSelectExecutionMode={onSelectExecutionMode}
      />
    </div>
  );
}
