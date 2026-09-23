import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TopBar } from "./components/TopBar";
import { Sidebar, TaskSummary } from "./components/Sidebar";
import { CenterHome } from "./components/CenterHome";
import { PromptCard } from "./components/PromptCard";
import type { TerminalSession } from "./components/TerminalPanel";
import { PanelResizer } from "./components/PanelResizer";
import { StageTelemetryHud } from "./components/StageTelemetryHud";
import { MessageStream } from "./components/MessageStream";
import { useToast } from "./components/Toast";
import {
  AppSettings,
  ChatMessage,
  ExecutionMode,
  Project,
  ReasoningEffort,
  SessionSummary,
  Soul,
} from "./types/chat";
import { generateDefaultTaskTitle } from "./utils/tasks";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { buildCommandActions, useAvailableCommands } from "./hooks/useCommandActions";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useKernelStreams } from "./hooks/useKernelStreams";
import { useChatPersistence } from "./hooks/useChatPersistence";
import { useComposerDrafts } from "./hooks/useComposerDrafts";
import { useActiveProfile } from "./hooks/useActiveProfile";
import { useSendMessage } from "./hooks/useSendMessage";
import { useProjectSoulState } from "./hooks/useProjectSoulState";
import { dshClient } from "./services/dshClient";
import { applyTheme, normalizeThemeMode } from "./themes";
import { useTranslation } from "react-i18next";
import { matchesShortcut } from "./commands/registry";

// ── Heavy / rarely-visible panels: lazy-split so three/ogl/xterm/md ──
// ── stay out of the initial bundle (paired with manualChunks).     ──
const SettingsView = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const GitSourceControlPanel = lazy(() =>
  import("./components/GitSourceControlPanel").then((m) => ({ default: m.GitSourceControlPanel })),
);
const TerminalPanel = lazy(() => import("./components/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));
const Grainient = lazy(() => import("./components/Grainient").then((m) => ({ default: m.Grainient })));
const ProjectDialog = lazy(() => import("./components/ProjectDialog").then((m) => ({ default: m.ProjectDialog })));
const SoulManagerDialog = lazy(() =>
  import("./components/SoulManagerDialog").then((m) => ({ default: m.SoulManagerDialog })),
);
const AboutDialog = lazy(() => import("./components/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })));

export function App() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ mode: "create" | "edit"; projectId?: string } | null>(null);
  const [souls, setSouls] = useState<Soul[]>([]);
  const [isSoulDialogOpen, setIsSoulDialogOpen] = useState<boolean>(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [activeGitProjectId, setActiveGitProjectId] = useState<string | null>(null);
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
      // Follow the OS live: re-resolve whenever the preference flips.
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

  // ── Clear History ────────────────────────────────────────────
  const handleClearHistory = async () => {
    setMessages([]);
    setActiveSessionId(null);
    setSessions([]);
    try {
      await invoke("clear_history");
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  // ── Start New Task (inside the given project) ─────────────────
  const handleNewTask = async (projectId?: string) => {
    const targetProjectId = projectId || activeProjectId;
    if (targetProjectId) setActiveProjectId(targetProjectId);
    const title = generateDefaultTaskTitle(sessions, targetProjectId, t);
    try {
      const created = await invoke<SessionSummary>("create_session", {
        title,
        projectId: targetProjectId,
      });
      setActiveSessionId(created.id);
      setMessages([]);
      // The composer swaps to the new session's (empty) draft via the
      // activeSessionId effect — an explicit clear here would also wipe the
      // preserved home draft when a task is started from the greeting stage.
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    } catch (err) {
      console.error(t("app.createSessionFailed"), err);
    }
  };

  // ── Rename Session ───────────────────────────────────────────
  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      await invoke("rename_session", { sessionId, newTitle });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
    } catch (err) {
      console.error("Failed to rename session:", err);
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

  // ── Select Existing Session ──────────────────────────────────
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    try {
      const msgs = await invoke<ChatMessage[]>("load_session_messages", { sessionId });
      setActiveSessionId(sessionId);
      setMessages(msgs || []);
    } catch (err) {
      console.error(t("app.loadSessionFailed"), err);
    }
  };

  // ── Delete Session ───────────────────────────────────────────
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await invoke("delete_session", { sessionId });
      const updated = sessions.filter((s) => s.id !== sessionId);
      setSessions(updated);
      if (activeSessionId === sessionId) {
        if (updated.length > 0) {
          handleSelectSession(updated[0].id);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error(t("app.deleteSessionFailed"), err);
    }
  };

  // ── Open Workspace Directory (active project's default directory) ──
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
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

  // ── Model selection: (provider, model) pair ────────────────
  // The picked pair is persisted as the app default: switching provider
  // flips the active profile, stores the model as that provider's
  // default, and records activeProfileId/selectedModel on settings so
  // the choice is restored verbatim on the next launch.
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

  // ── Reasoning effort selection (persisted) ───────────────────
  const handleSelectReasoningEffort = (effort: ReasoningEffort) => {
    setReasoningEffort(effort);
    if (settings) {
      handleSaveSettings({ ...settings, reasoningEffort: effort });
    }
  };

  // ── Execution mode selection (persisted) ─────────────────────
  const handleSelectExecutionMode = (mode: ExecutionMode) => {
    setExecutionMode(mode);
    if (settings) {
      handleSaveSettings({ ...settings, executionMode: mode });
    }
  };

  // ── Send pipeline (verbatim move → hooks/useSendMessage) ────
  const { handleSend } = useSendMessage({
    settings,
    activeProfile,
    selectedModel,
    reasoningEffort,
    executionMode,
    orchestrationStages,
    draft,
    isSending,
    messages,
    sessions,
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

  // ── Embedded terminal dock (bottom of main area) ─────────────
  const terminalCwd = useMemo(() => {
    return activeProject?.defaultDirectory || workspacePath || "";
  }, [activeProject, workspacePath]);

  const handleNewTerminal = () => {
    const id = crypto.randomUUID();
    const seed: TerminalSession = {
      id,
      title: t("terminal.fallbackTitle"),
      cwd: terminalCwd,
    };
    setTerminals((prev) => [...prev, seed]);
    setActiveTerminalId(id);
    setIsTerminalOpen(true);
    setCurrentView("workspace");
  };

  const handleTerminalCreated = (info: TerminalSession) => {
    setTerminals((prev) => prev.map((t) => (t.id === info.id ? info : t)));
  };

  const handleTerminalClosed = (id: string) => {
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTerminalId((cur) => {
        if (cur !== id) return cur;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      if (next.length === 0) setIsTerminalOpen(false);
      return next;
    });
  };

  const handleCloseOneTerminal = async (id: string) => {
    // Close backend first so its exit event (which also removes the tab)
    // stays idempotent; then drop the tab locally.
    try {
      await invoke("close_terminal", { id });
    } catch {
      /* backend already reaped */
    }
    handleTerminalClosed(id);
  };

  // ── Copy a settled message to the clipboard (toast feedback) ──
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
  // A command is offered only when its action is wired and meaningful in the
  // current state (e.g. the git panel toggle needs an active project).
  const commandActions = useMemo<Record<string, () => void>>(
    () =>
      buildCommandActions({
        settings,
        activeProjectId,
        onNewTask: () => void handleNewTask(),
        onNewProject: () => setProjectDialog({ mode: "create" }),
        onNewTerminal: handleNewTerminal,
        onOpenSettings: () => setCurrentView("settings"),
        onOpenSouls: () => setIsSoulDialogOpen(true),
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

  // ── Keyboard shortcuts (Ctrl+N new task · Ctrl+K / Ctrl+Shift+P palette) ──
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
        onNewTerminal={handleNewTerminal}
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
            projects={projects}
            tasks={sidebarTasks}
            activeTaskId={activeSessionId || undefined}
            activeProjectId={activeProjectId}
            activeGitProjectId={activeGitProjectId}
            onSelectProject={setActiveProjectId}
            onNewProject={() => setProjectDialog({ mode: "create" })}
            onNewTask={(projectId) => handleNewTask(projectId)}
            onOpenProjectSettings={(projectId) => setProjectDialog({ mode: "edit", projectId })}
            onToggleGitPanel={(projectId) =>
              setActiveGitProjectId((cur) => (cur === projectId ? null : projectId))
            }
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

          {/* Source Control Secondary Sidebar (VS Code Style) */}
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
                  onSend={handleSend}
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
                /* Active Conversation View — WeChat style: avatar + bubble rows */
                <div className="chat-conversation-view">
                  <MessageStream
                    messages={messages}
                    userName={settings?.userName?.trim() || t("app.me")}
                    onCopyMessage={(content) => void copyMessage(content)}
                  />

                  {/* Bottom Docked Input Box in Active Chat */}
                  <div className="chat-docked-input">
                    <PromptCard
                      projectName={activeProject?.name?.trim() || workspaceName}
                      projectTooltip={activeProject?.description || activeProject?.defaultDirectory || undefined}
                      placeholder={t("home.followUpPlaceholder")}
                      draft={draft}
                      setDraft={setDraft}
                      onSend={handleSend}
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

      {/* Project create / settings dialog */}
      {projectDialog && (
        <Suspense fallback={null}>
          <ProjectDialog
            mode={projectDialog.mode}
            project={
              projectDialog.mode === "edit"
                ? projects.find((p) => p.id === projectDialog.projectId) ?? null
                : null
            }
            fallbackDirectory={workspacePath}
            isLastProject={projects.length <= 1}
            fallbackProjectName={projects.find((p) => p.id !== projectDialog.projectId)?.name}
            onClose={() => setProjectDialog(null)}
            onSaved={handleProjectSaved}
            onDeleted={handleProjectDeleted}
          />
        </Suspense>
      )}

      {/* Souls (persona) manager */}
      {isSoulDialogOpen && (
        <Suspense fallback={null}>
          <SoulManagerDialog
            souls={souls}
            activeSoul={activeSoulFolder}
            onActivate={handleActivateSoul}
            onChanged={handleSoulsChanged}
            onDeleted={handleSoulDeleted}
            onClose={() => setIsSoulDialogOpen(false)}
          />
        </Suspense>
      )}

      {/* About / Charter Modal (question-mark button · Ctrl+K palette entry) */}
      {isAboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setIsAboutOpen(false)} />
        </Suspense>
      )}

      {/* Command Center (Ctrl+K / Ctrl+Shift+P) */}
      {isPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setIsPaletteOpen(false)}
            commands={availableCommands}
            tasks={paletteTasks}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            activeTaskId={activeSessionId}
            activeProjectId={activeProjectId}
            onRunCommand={(id) => commandActions[id]?.()}
            onSelectTask={(id) => {
              setCurrentView("workspace");
              void handleSelectSession(id);
            }}
            onSelectProject={(id) => {
              setCurrentView("workspace");
              setActiveProjectId(id);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
