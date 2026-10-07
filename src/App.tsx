import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { TopBar } from "./components/TopBar";
import { Sidebar, TaskSummary } from "./components/Sidebar";
import { CenterHome } from "./components/CenterHome";
import { PromptCard } from "./components/PromptCard";
import { PanelResizer } from "./components/PanelResizer";
import { StageTelemetryHud } from "./components/StageTelemetryHud";
import { GoalBar } from "./components/GoalBar";
import { MessageStream } from "./components/MessageStream";
import { useToast } from "./components/Toast";
import {
  AppSettings,
  ExecutionMode,
  Project,
  ReasoningEffort,
  Soul,
} from "./types/chat";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { buildCommandActions, useAvailableCommands } from "./hooks/useCommandActions";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useKernelStreams } from "./hooks/useKernelStreams";
import { useChatPersistence } from "./hooks/useChatPersistence";
import { useComposerDrafts } from "./hooks/useComposerDrafts";
import { useActiveProfile } from "./hooks/useActiveProfile";
import { useSendMessage } from "./hooks/useSendMessage";
import { useProjectSoulState } from "./hooks/useProjectSoulState";
import { useSessionState } from "./features/sessions/useSessionState";
import { useTerminalState } from "./features/terminal/useTerminalState";
import { AppModals } from "./features/modals/AppModals";
import { applyTheme, normalizeThemeMode } from "./themes";
import { matchesShortcut } from "./commands/registry";

// ── Heavy / rarely-visible panels: lazy-split so three/ogl/xterm/md ──
// ── stay out of the initial bundle (paired with manualChunks).     ──
const SettingsView = lazy(() => import("./features/settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const GitSourceControlPanel = lazy(() =>
  import("./features/git/GitSourceControlPanel").then((m) => ({ default: m.GitSourceControlPanel })),
);
const WorkspaceTreePanel = lazy(() =>
  import("./components/WorkspaceTreePanel").then((m) => ({ default: m.WorkspaceTreePanel })),
);
const TerminalPanel = lazy(() => import("./components/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const Grainient = lazy(() => import("./components/Grainient").then((m) => ({ default: m.Grainient })));

export function App() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ mode: "create" | "edit"; projectId?: string } | null>(null);
  const [souls, setSouls] = useState<Soul[]>([]);
  const [isSoulDialogOpen, setIsSoulDialogOpen] = useState<boolean>(false);
  const [isPluginDialogOpen, setIsPluginDialogOpen] = useState<boolean>(false);

  // ── Session State (extracted hook) ──
  const {
    messages,
    setMessages,
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    handleNewTask,
    handleRenameSession,
    handleSelectSession,
    handleDeleteSession,
    handleClearHistory,
  } = useSessionState(activeProjectId, setActiveProjectId);

  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("deepseek-flash");
  const [reasoningEffort, setReasoningEffort] = useState<"off" | "low" | "high" | "max">("high");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("ask");
  const [draft, setDraft] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<"workspace" | "settings">("workspace");
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [workspacePath, setWorkspacePath] = useState<string>("");

  // ── Terminal State (extracted hook) ──
  const {
    terminals,
    activeTerminalId,
    setActiveTerminalId,
    isTerminalOpen,
    setIsTerminalOpen,
    handleNewTerminal,
    handleTerminalCreated,
    handleTerminalClosed,
    handleCloseOneTerminal,
  } = useTerminalState();

  const [activeGitProjectId, setActiveGitProjectId] = useState<string | null>(null);
  const [activeFilesProjectId, setActiveFilesProjectId] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  // ── Panel sizing (localStorage-persisted view state) ──
  const {
    sidebarWidth,
    handleResizeSidebar,
    handleResetSidebar,
    gitPanelWidth,
    handleResizeGitPanel,
    handleResetGitPanel,
    terminalHeight,
    handleResizeTerminal,
    handleResetTerminal,
  } = usePanelLayout();

  const activeSessionIdRef = useRef<string | null>(null);
  const isSendingRef = useRef<boolean>(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Startup fan-in lives in hooks; streaming merge stays frontend (per-token).
  useAppBootstrap(
    {
      setSettings,
      setActiveProfileId,
      setSelectedModel,
      setReasoningEffort,
      setExecutionMode,
      setSessions,
      setActiveSessionId,
      setMessages,
      setWorkspacePath,
      setProjects,
      setActiveProjectId,
      setSouls,
    },
    tRef,
  );
  useKernelStreams(setMessages, { isSendingRef, activeSessionIdRef, tRef });

  // ── Apply theme + font scale ─────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    const mode = normalizeThemeMode(settings.themeMode);
    applyTheme(mode);
    if (mode === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme(mode);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
  }, [settings?.themeMode]);

  useEffect(() => {
    const size = settings?.fontSize ?? "14px";
    const zoom = size === "13px" ? 0.94 : size === "15px" ? 1.06 : 1.0;
    document.body.style.zoom = String(zoom);
  }, [settings?.fontSize]);

  // ── Persist chat history (debounced) ─────────────────────────
  useChatPersistence(settings, messages, activeSessionId, setSessions);

  // ── Composer drafts: per-session persistence ─────────────────
  useComposerDrafts(draft, activeSessionId, setDraft);

  // ── Derived active profile ───────────────────────────────────
  const { activeProfile, orchestrationStages } = useActiveProfile(
    settings,
    activeProfileId,
    setSelectedModel,
  );

  // ── Save Settings Helper ─────────────────────────────────────
  const handleSaveSettings = async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    try {
      await invoke("save_settings", { settings: nextSettings });
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // ── Active Project & Session ─────────────────────────────────
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const openDirectory = activeProject?.defaultDirectory || workspacePath;

  const handleOpenWorkspace = async () => {
    if (!openDirectory) return;
    try {
      await invoke("open_path_in_explorer", { path: openDirectory });
    } catch (err) {
      console.error("Failed to open path:", err);
    }
  };

  // ── Souls (personas) ─────────────────────────────────────────
  const activeSoulFolder = settings?.activeSoul ?? "Default";

  // ── Projects & Souls: CRUD handlers (hook-extracted) ─────────
  const {
    handleProjectSaved,
    handleProjectDeleted,
    handleActivateSoul,
    handleSoulsChanged,
    handleSoulDeleted,
  } = useProjectSoulState(
    settings,
    activeProjectId,
    activeGitProjectId,
    activeSoulFolder,
    setProjects,
    setActiveProjectId,
    setActiveGitProjectId,
    setSessions,
    setSouls,
    handleSaveSettings,
  );

  // ── Model & Mode selection ───────────────────────────────────
  const handleSelectModel = (profileId: string, modelName: string) => {
    setActiveProfileId(profileId);
    setSelectedModel(modelName);
    if (settings) {
      void handleSaveSettings({
        ...settings,
        activeProfileId: profileId,
        selectedModel: modelName,
        aiProfiles: settings.aiProfiles.map((p) =>
          p.id === profileId ? { ...p, model: modelName } : p
        ),
      });
    }
  };

  const handleSelectReasoningEffort = (effort: ReasoningEffort) => {
    setReasoningEffort(effort);
    if (settings) {
      handleSaveSettings({ ...settings, reasoningEffort: effort });
    }
  };

  const handleSelectExecutionMode = (mode: ExecutionMode) => {
    setExecutionMode(mode);
    if (settings) {
      handleSaveSettings({ ...settings, executionMode: mode });
    }
  };

  // ── Send pipeline ────────────────────────────────────────────
  const { handleSend, handlePause } = useSendMessage({
    settings,
    activeProfile,
    selectedModel,
    reasoningEffort,
    executionMode,
    orchestrationStages,
    draft,
    isSending,
    messages,
    activeSessionId,
    activeProjectId,
    activeSessionIdRef,
    isSendingRef,
    tRef,
    setDraft,
    setIsSending,
    setMessages,
    setSessions,
    setActiveSessionId,
    t,
  });

  const terminalCwd = useMemo(() => {
    return activeProject?.defaultDirectory || workspacePath || "";
  }, [activeProject, workspacePath]);

  const onNewTerminalClick = () => {
    handleNewTerminal(terminalCwd, () => setCurrentView("workspace"));
  };

  // ── Copy message to clipboard ────────────────────────────────
  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast(t("app.messageCopied"), "success");
    } catch {
      showToast(t("app.messageCopyFailed"), "danger");
    }
  };

  // ── Tasks list for sidebar from native sessions ──────────────
  const sidebarTasks: TaskSummary[] = useMemo(() => {
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      timestamp: s.updatedAt,
      projectId: s.projectId,
    }));
  }, [sessions]);

  // ── Command palette wiring ────────────────────────────────────
  const commandActions = useMemo<Record<string, () => void>>(
    () =>
      buildCommandActions({
        settings,
        activeProjectId,
        onNewTask: () => void handleNewTask(),
        onNewProject: () => setProjectDialog({ mode: "create" }),
        onNewTerminal: onNewTerminalClick,
        onOpenSettings: () => setCurrentView("settings"),
        onOpenSouls: () => setIsSoulDialogOpen(true),
        onOpenPlugins: () => setIsPluginDialogOpen(true),
        onOpenAbout: () => setIsAboutOpen(true),
        onToggleSidebar: () => setIsSidebarCollapsed((prev) => !prev),
        onToggleGitPanel: (projectId) =>
          setActiveGitProjectId((cur) => (cur === projectId ? null : projectId)),
        onSaveSettings: ({ themeMode }) => {
          if (!settings) return;
          void handleSaveSettings({ ...settings, themeMode });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, activeProjectId, handleNewTask],
  );

  const availableCommands = useAvailableCommands(commandActions);

  const paletteTasks = useMemo(
    () =>
      sidebarTasks.map((task) => ({
        id: task.id,
        title: task.title,
        projectName: projects.find((p) => p.id === task.projectId)?.name,
      })),
    [sidebarTasks, projects],
  );

  // ── Keyboard shortcuts (Ctrl+N · Ctrl+K / Ctrl+Shift+P) ──────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, "Ctrl+N")) {
        e.preventDefault();
        handleNewTask();
      } else if (matchesShortcut(e, "Ctrl+K") || matchesShortcut(e, "Ctrl+Shift+P")) {
        e.preventDefault();
        setIsPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const workspaceName = useMemo(() => {
    const dir = openDirectory;
    if (!dir) return "Atrium";
    const parts = dir.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "Atrium";
  }, [openDirectory]);

  return (
    <div className="app-container">
      {/* 1:1 Top Bar */}
      <TopBar
        sidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onNewTerminal={onNewTerminalClick}
        onOpenAbout={() => setIsAboutOpen(true)}
        projectName={activeProject?.name?.trim() || workspaceName || "初始空间"}
      />

      {currentView === "settings" && settings ? (
        <Suspense fallback={null}>
          <SettingsView
            onBack={() => setCurrentView("workspace")}
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onClearHistory={handleClearHistory}
            workspacePath={workspacePath}
            onOpenWorkspace={handleOpenWorkspace}
          />
        </Suspense>
      ) : (
        /* Main Workspace Body */
        <div className="workspace-body">
          {/* 1:1 Left Sidebar: project tree */}
          <Sidebar
            userName={settings?.userName || "Tempsyche"}
            isCollapsed={isSidebarCollapsed}
            width={sidebarWidth}
            onOpenSettings={() => setCurrentView("settings")}
            onOpenSouls={() => setIsSoulDialogOpen(true)}
            onOpenPlugins={() => setIsPluginDialogOpen(true)}
            projects={projects}
            tasks={sidebarTasks}
            activeTaskId={activeSessionId || undefined}
            activeProjectId={activeProjectId}
            activeGitProjectId={activeGitProjectId}
            onSelectProject={setActiveProjectId}
            onNewProject={() => setProjectDialog({ mode: "create" })}
            onNewTask={(projectId) => handleNewTask(projectId)}
            onOpenProjectSettings={(projectId) => setProjectDialog({ mode: "edit", projectId })}
            onToggleGitPanel={(projectId) => {
              setActiveFilesProjectId(null);
              setActiveGitProjectId((cur) => (cur === projectId ? null : projectId));
            }}
            onToggleFilesPanel={(projectId) => {
              setActiveGitProjectId(null);
              setActiveFilesProjectId((cur) => (cur === projectId ? null : projectId));
            }}
            activeFilesProjectId={activeFilesProjectId}
            onSelectTask={handleSelectSession}
            onDeleteTask={handleDeleteSession}
            onRenameTask={handleRenameSession}
          />

          {!isSidebarCollapsed && (
            <PanelResizer
              orientation="vertical"
              onResize={handleResizeSidebar}
              onReset={handleResetSidebar}
            />
          )}

          {/* Workspace Files Secondary Sidebar */}
          {activeFilesProjectId && (
            <>
              <Suspense fallback={null}>
                <WorkspaceTreePanel
                  projectId={activeFilesProjectId}
                  project={projects.find((p) => p.id === activeFilesProjectId)}
                  workspacePath={workspacePath}
                  width={gitPanelWidth}
                  onClose={() => setActiveFilesProjectId(null)}
                />
              </Suspense>
              <PanelResizer
                orientation="vertical"
                onResize={handleResizeGitPanel}
                onReset={handleResetGitPanel}
              />
            </>
          )}

          {/* Source Control Secondary Sidebar */}
          {activeGitProjectId && (
            <>
              <Suspense fallback={null}>
                <GitSourceControlPanel
                  projectId={activeGitProjectId}
                  project={projects.find((p) => p.id === activeGitProjectId)}
                  workspacePath={workspacePath}
                  width={gitPanelWidth}
                  onClose={() => setActiveGitProjectId(null)}
                />
              </Suspense>
              <PanelResizer
                orientation="vertical"
                onResize={handleResizeGitPanel}
                onReset={handleResetGitPanel}
              />
            </>
          )}

          {/* Main Stage & Docked Panels Column */}
          <div className="main-stage-column">
            {/* Center Stage Canvas */}
            <main className="stage-container">
              <Suspense fallback={null}>
                <Grainient
                  className="stage-marble-bg"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                  color1="#dfceaf"
                  color2="#D4A26A"
                  color3="#5C4A3E"
                  timeSpeed={0.8}
                  colorBalance={0}
                  warpStrength={1.2}
                  warpFrequency={8.5}
                  warpSpeed={2}
                  warpAmplitude={50}
                  blendAngle={0}
                  blendSoftness={0.05}
                  rotationAmount={500}
                  noiseScale={2}
                  grainAmount={0.1}
                  grainScale={2}
                  grainAnimated={false}
                  contrast={1.5}
                  gamma={1}
                  saturation={1}
                  centerX={0}
                  centerY={0}
                  zoom={0.9}
                />
              </Suspense>
              <StageTelemetryHud
                messages={messages}
                selectedModel={selectedModel}
                activeProfile={activeProfile}
                isStreaming={isSending}
                sessionKey={activeSessionId}
              />
              {messages.length === 0 ? (
                /* Home / Greeting Stage */
                <CenterHome
                  draft={draft}
                  setDraft={setDraft}
                  onSend={() => void handleSend()}
                  onPause={() => void handlePause()}
                  isSending={isSending}
                  activeProject={activeProject}
                  fallbackProjectName={workspaceName}
                  souls={souls}
                  activeSoul={activeSoulFolder}
                  onActivateSoul={handleActivateSoul}
                  profiles={settings?.aiProfiles ?? []}
                  activeProfileId={activeProfile?.id ?? null}
                  selectedModel={selectedModel}
                  onSelectModel={handleSelectModel}
                  reasoningEffort={reasoningEffort}
                  onSelectReasoningEffort={handleSelectReasoningEffort}
                  executionMode={executionMode}
                  onSelectExecutionMode={handleSelectExecutionMode}
                />
              ) : (
                /* Active Conversation View */
                <div className="chat-conversation-view">
                  <GoalBar
                    goalText={activeSession?.title || messages[0]?.content?.slice(0, 80) || null}
                    isStreaming={isSending}
                    onUpdateGoal={(newGoal) => {
                      if (activeSessionId) {
                        handleRenameSession(activeSessionId, newGoal);
                      }
                    }}
                  />

                  <MessageStream
                    messages={messages}
                    userName={settings?.userName?.trim() || t("app.me")}
                    onCopyMessage={(content) => void copyMessage(content)}
                    onSendAnswer={(answer) => void handleSend(answer)}
                  />

                  {/* Bottom Docked Input Box in Active Chat */}
                  <div className="chat-docked-input">
                    <PromptCard
                      projectName={activeProject?.name?.trim() || workspaceName}
                      projectTooltip={activeProject?.description || activeProject?.defaultDirectory || undefined}
                      placeholder={t("home.followUpPlaceholder")}
                      draft={draft}
                      setDraft={setDraft}
                      onSend={() => void handleSend()}
                      onPause={() => void handlePause()}
                      isSending={isSending}
                      souls={souls}
                      activeSoul={activeSoulFolder}
                      onActivateSoul={handleActivateSoul}
                      profiles={settings?.aiProfiles ?? []}
                      activeProfileId={activeProfile?.id ?? null}
                      selectedModel={selectedModel}
                      onSelectModel={handleSelectModel}
                      reasoningEffort={reasoningEffort}
                      onSelectReasoningEffort={handleSelectReasoningEffort}
                      executionMode={executionMode}
                      onSelectExecutionMode={handleSelectExecutionMode}
                    />
                  </div>
                </div>
              )}
            </main>

            {/* Independent Terminal Island Card */}
            {isTerminalOpen && terminals.length > 0 && (
              <>
                <PanelResizer
                  orientation="horizontal"
                  onResize={(delta) => handleResizeTerminal(-delta)}
                  onReset={handleResetTerminal}
                />
                <Suspense fallback={null}>
                  <TerminalPanel
                    terminals={terminals}
                    activeId={activeTerminalId ?? terminals[terminals.length - 1]?.id ?? null}
                    cwd={terminalCwd}
                    height={terminalHeight}
                    onSelect={setActiveTerminalId}
                    onCreated={handleTerminalCreated}
                    onClosed={handleTerminalClosed}
                    onCloseTerminal={handleCloseOneTerminal}
                  />
                </Suspense>
              </>
            )}
          </div>
        </div>
      )}

      {/* Global Modals (Extracted Feature Component) */}
      <AppModals
        projectDialog={projectDialog}
        setProjectDialog={setProjectDialog}
        projects={projects}
        workspacePath={workspacePath}
        onProjectSaved={handleProjectSaved}
        onProjectDeleted={handleProjectDeleted}
        isSoulDialogOpen={isSoulDialogOpen}
        setIsSoulDialogOpen={setIsSoulDialogOpen}
        isPluginDialogOpen={isPluginDialogOpen}
        setIsPluginDialogOpen={setIsPluginDialogOpen}
        souls={souls}
        activeSoulFolder={activeSoulFolder}
        onActivateSoul={handleActivateSoul}
        onSoulsChanged={handleSoulsChanged}
        onSoulDeleted={handleSoulDeleted}
        isAboutOpen={isAboutOpen}
        setIsAboutOpen={setIsAboutOpen}
        isPaletteOpen={isPaletteOpen}
        setIsPaletteOpen={setIsPaletteOpen}
        availableCommands={availableCommands}
        paletteTasks={paletteTasks}
        activeSessionId={activeSessionId}
        activeProjectId={activeProjectId}
        commandActions={commandActions}
        onSelectTask={(id) => {
          setCurrentView("workspace");
          void handleSelectSession(id);
        }}
        onSelectProject={(id) => {
          setCurrentView("workspace");
          setActiveProjectId(id);
        }}
      />
    </div>
  );
}
