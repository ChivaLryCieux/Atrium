import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TopBar } from "./components/TopBar";
import { Sidebar, TaskSummary } from "./components/Sidebar";
import { CenterHome } from "./components/CenterHome";
import { SettingsView } from "./components/SettingsView";
import { ProjectDialog } from "./components/ProjectDialog";
import { SoulManagerDialog } from "./components/SoulManagerDialog";
import { AboutDialog } from "./components/AboutDialog";
import { PromptCard } from "./components/PromptCard";
import { TerminalPanel, TerminalSession } from "./components/TerminalPanel";
import { createUserMessage } from "./constants/defaults";
import {
  AiProfile,
  AppSettings,
  ChatMessage,
  ExecutionMode,
  OrchestrationProgressEvent,
  OrchestrationStage,
  PendingMessage,
  Project,
  ReasoningEffort,
  SessionSummary,
  Soul,
} from "./types/chat";
import { createPendingMessages } from "./utils/messages";
import { dshClient } from "./services/dshClient";

export function App() {
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
  const [orchestrationStages, setOrchestrationStages] = useState<OrchestrationStage[]>([]);
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // ── Load Settings, Sessions & History ────────────────────────
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => {
        // Ensure default username is Tempsyche if empty
        if (!loaded.userName || loaded.userName === "OPERATOR") {
          loaded.userName = "Tempsyche";
        }
        setSettings(loaded);
        if (loaded.aiProfiles.length > 0) {
          setActiveProfileId(loaded.aiProfiles[0].id);
          if (loaded.aiProfiles[0].model) {
            setSelectedModel(loaded.aiProfiles[0].model);
          }
        }
        if (loaded.reasoningEffort) {
          // The UI offers three tiers; legacy "off" normalizes to 低耗推理.
          setReasoningEffort(loaded.reasoningEffort === "off" ? "low" : loaded.reasoningEffort);
        }
        if (loaded.executionMode) {
          setExecutionMode(loaded.executionMode);
        }
      })
      .catch(console.error);

    invoke<SessionSummary[]>("list_sessions")
      .then((sessionList) => {
        if (sessionList && sessionList.length > 0) {
          setSessions(sessionList);
          const first = sessionList[0];
          setActiveSessionId(first.id);
          invoke<ChatMessage[]>("load_session_messages", { sessionId: first.id })
            .then((loadedMsgs) => {
              if (loadedMsgs && loadedMsgs.length > 0) setMessages(loadedMsgs);
            })
            .catch(console.error);
        } else {
          // Fallback to legacy history if any
          invoke<ChatMessage[]>("load_history")
            .then(async (cached) => {
              if (cached && cached.length > 0) {
                try {
                  const firstUser = cached.find((m) => m.role === "user");
                  const title = firstUser ? firstUser.content.slice(0, 20) : "历史任务";
                  const created = await invoke<SessionSummary>("create_session", { title });
                  await invoke("save_session_messages", {
                    sessionId: created.id,
                    messages: cached,
                  });
                  setSessions([created]);
                  setActiveSessionId(created.id);
                  setMessages(cached);
                } catch {
                  setMessages(cached);
                }
              }
            })
            .catch(console.error);
        }
      })
      .catch(console.error);

    invoke<string>("get_default_workspace_path")
      .then(setWorkspacePath)
      .catch(console.error);

    // Projects (creates the default project and migrates legacy sessions)
    invoke<Project[]>("list_projects")
      .then((list) => {
        setProjects(list);
        if (list.length > 0) setActiveProjectId(list[0].id);
      })
      .catch(console.error);

    // Personas (creates Souls/Default/SOUL.md on first run)
    invoke<Soul[]>("list_souls").then(setSouls).catch(console.error);

    // Initialize DSH daemon client in background
    dshClient.init().catch(console.error);

    // Live kernel stream: streamed deltas land in the matching pending node.
    // Parallel-mode sub-conversations are suffixed `::parallel-N`, so prefix
    // matching keeps their deltas flowing to the same session view.
    const unlistenStream = dshClient.onStream((chunk) => {
      const active = activeSessionIdRef.current;
      if (chunk.conversationId && (!active || !chunk.conversationId.startsWith(active))) return;
      if (!chunk.stageId || !chunk.content) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== chunk.stageId || !msg.pending) return msg;
          const isPlaceholder = msg.content === "思考中..." || msg.content.includes("正在解析推演中");
          return { ...msg, content: isPlaceholder ? chunk.content! : msg.content + chunk.content! };
        })
      );
    });

    return () => {
      unlistenStream();
    };
  }, []);

  // ── Auto-scroll to latest message ────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ── Apply theme + font scale ─────────────────────────────────
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const theme = settings.themeMode ?? "light";
    root.dataset.theme = theme;
    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      root.dataset.resolvedTheme = media.matches ? "dark" : "light";
      const onChange = (e: MediaQueryListEvent) => {
        root.dataset.resolvedTheme = e.matches ? "dark" : "light";
      };
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    root.dataset.resolvedTheme = theme;
  }, [settings?.themeMode]);

  useEffect(() => {
    const size = settings?.fontSize ?? "14px";
    const zoom = size === "13px" ? 0.94 : size === "15px" ? 1.06 : 1.0;
    document.body.style.zoom = String(zoom);
  }, [settings?.fontSize]);

  // ── Persist chat history (debounced) ─────────────────────────
  useEffect(() => {
    if (!settings || messages.length === 0) return;
    if (saveTimeoutRef.current !== undefined) {
      clearTimeout(saveTimeoutRef.current);
    }
    const timeoutId = setTimeout(() => {
      if (activeSessionId) {
        invoke("save_session_messages", {
          sessionId: activeSessionId,
          messages,
        })
          .then(() => {
            invoke<SessionSummary[]>("list_sessions")
              .then(setSessions)
              .catch(console.error);
          })
          .catch(console.error);
      }
      invoke("save_history", { messages }).catch(console.error);
    }, 500);
    saveTimeoutRef.current = timeoutId;
  }, [messages, activeSessionId, settings]);

  // ── Derived active profile ───────────────────────────────────
  const activeProfile = useMemo(() => {
    return (
      settings?.aiProfiles.find((p) => p.id === activeProfileId) ||
      settings?.aiProfiles[0] ||
      null
    );
  }, [activeProfileId, settings]);

  // ── Follow the active profile's default model on switch ──────
  useEffect(() => {
    if (activeProfile?.model) {
      setSelectedModel(activeProfile.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  // ── Build Orchestration Stages ───────────────────────────────
  useEffect(() => {
    if (!activeProfile || !settings) return;
    invoke<OrchestrationStage[]>("build_orchestration", {
      profiles: [activeProfile],
    })
      .then(setOrchestrationStages)
      .catch(console.error);
  }, [activeProfile, settings]);

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
  const handleNewTask = (projectId?: string) => {
    if (projectId) setActiveProjectId(projectId);
    setActiveSessionId(null);
    setMessages([]);
    setDraft("");
  };

  // ── Project dialog save ──────────────────────────────────────
  const handleProjectSaved = (saved: Project) => {
    invoke<Project[]>("list_projects")
      .then((list) => {
        setProjects(list);
        setActiveProjectId(saved.id);
      })
      .catch(console.error);
  };

  // ── Souls (personas) ─────────────────────────────────────────
  const activeSoulFolder = settings?.activeSoul ?? "Default";

  const handleActivateSoul = (folder: string) => {
    if (settings) {
      handleSaveSettings({ ...settings, activeSoul: folder });
    }
  };

  const handleSoulsChanged = () => {
    invoke<Soul[]>("list_souls").then(setSouls).catch(console.error);
  };

  const handleSoulDeleted = (folder: string) => {
    handleSoulsChanged();
    if (folder === activeSoulFolder) {
      handleActivateSoul("Default");
    }
  };

  // ── Select Existing Session ──────────────────────────────────
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    try {
      const msgs = await invoke<ChatMessage[]>("load_session_messages", { sessionId });
      setActiveSessionId(sessionId);
      setMessages(msgs || []);
    } catch (err) {
      console.error("加载会话失败:", err);
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
      console.error("删除会话失败:", err);
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

  // ── Send Message ─────────────────────────────────────────────
  const handleSend = async () => {
    if (!draft.trim() || !activeProfile || !settings || isSending) return;

    let curSessionId = activeSessionId;
    if (!curSessionId) {
      try {
        const title = draft.trim().slice(0, 20);
        const created = await invoke<SessionSummary>("create_session", {
          title,
          projectId: activeProjectId,
        });
        curSessionId = created.id;
        setActiveSessionId(curSessionId);
        setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      } catch (err) {
        console.error("无法创建新会话:", err);
      }
    }

    const userMessage = createUserMessage(draft.trim(), settings.userName || "Tempsyche");
    const baseMessages = [...messages, userMessage];

    // One pending bubble per pipeline node; its id equals the stage id so the
    // kernel's streamed deltas and settled replies land in the same node.
    const pendingMessages: PendingMessage[] =
      orchestrationStages.length > 0
        ? orchestrationStages.map((stage) => ({
            id: stage.id,
            role: "assistant" as const,
            content: "思考中...",
            speakerId: stage.profile.id,
            speakerName: `${stage.title} · ${stage.profile.name}`,
            avatar: stage.profile.avatar,
            pending: true as const,
          }))
        : createPendingMessages([activeProfile]);

    setDraft("");
    setIsSending(true);
    setMessages([...baseMessages, ...pendingMessages]);

    try {
      const unlisten = await listen<OrchestrationProgressEvent>(
        "orchestration-progress",
        (event) => {
          const { stageId, stageTitle, status: eventStatus } = event.payload;
          if (eventStatus === "running") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.pending && (!stageId || msg.id === stageId) && msg.content === "思考中..."
                  ? { ...msg, content: `[${stageTitle}] 正在解析推演中...` }
                  : msg
              )
            );
          }
        }
      );

      // Execute request
      const finalReplies = await invoke<ChatMessage[]>("execute_orchestration", {
        request: {
          profiles: [
            {
              ...activeProfile,
              model: selectedModel || activeProfile.model,
            },
          ],
          messages: baseMessages,
          mode: settings.orchestrationMode,
          conversationId: curSessionId,
          reasoningEffort,
          executionMode,
        },
      });

      unlisten();
      const updatedMessages = [...baseMessages, ...finalReplies];
      setMessages(updatedMessages);

      if (curSessionId) {
        invoke("save_session_messages", {
          sessionId: curSessionId,
          messages: updatedMessages,
        })
          .then(() => {
            invoke<SessionSummary[]>("list_sessions").then(setSessions).catch(console.error);
          })
          .catch(console.error);
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.pending
            ? {
                ...msg,
                content: `[调度执行异常] ${String(error)}`,
                pending: false,
                error: true,
              }
            : msg
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  // ── Embedded terminal dock (bottom of main area) ─────────────
  const terminalCwd = useMemo(() => {
    return activeProject?.defaultDirectory || workspacePath || "";
  }, [activeProject, workspacePath]);

  const handleNewTerminal = () => {
    const id = crypto.randomUUID();
    const seed: TerminalSession = {
      id,
      title: "终端",
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

  // ── Tasks list for sidebar from native sessions ──────────────
  const sidebarTasks: TaskSummary[] = useMemo(() => {
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      timestamp: s.updatedAt,
      projectId: s.projectId,
    }));
  }, [sessions]);

  // ── Keyboard shortcuts (Ctrl+N, Ctrl+K) ──────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewTask();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsAboutOpen(true);
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
      />

      {currentView === "settings" && settings ? (
        <SettingsView
          onBack={() => setCurrentView("workspace")}
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onClearHistory={handleClearHistory}
          workspacePath={workspacePath}
          onOpenWorkspace={handleOpenWorkspace}
        />
      ) : (
        /* Main Workspace Body */
        <div className="workspace-body">
          {/* 1:1 Left Sidebar: project tree */}
          <Sidebar
            userName={settings?.userName || "Tempsyche"}
            isCollapsed={isSidebarCollapsed}
            onOpenSettings={() => setCurrentView("settings")}
            onOpenSouls={() => setIsSoulDialogOpen(true)}
            projects={projects}
            tasks={sidebarTasks}
            activeTaskId={activeSessionId || undefined}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            onNewProject={() => setProjectDialog({ mode: "create" })}
            onNewTask={(projectId) => handleNewTask(projectId)}
            onOpenProjectSettings={(projectId) => setProjectDialog({ mode: "edit", projectId })}
            onSelectTask={handleSelectSession}
            onDeleteTask={handleDeleteSession}
          />

          {/* Center Stage Canvas */}
          <main className="stage-container">
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
                models={activeProfile?.models ?? []}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                reasoningEffort={reasoningEffort}
                onSelectReasoningEffort={handleSelectReasoningEffort}
                executionMode={executionMode}
                onSelectExecutionMode={handleSelectExecutionMode}
              />
            ) : (
              /* Active Conversation View */
              <div className="chat-conversation-view">
                <div className="chat-message-stream">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`message-bubble-row ${msg.role}`}>
                      <div className="bubble-body">
                        {msg.role === "assistant" && (
                          <div className="speaker-header">
                            <span className="node-badge">ATRIUM // {msg.speakerName}</span>
                            {msg.pending && <span>思考生成中...</span>}
                          </div>
                        )}
                        <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={messageEndRef} />
                </div>

                {/* Bottom Docked Input Box in Active Chat */}
                <div className="chat-docked-input">
                  <PromptCard
                    projectName={activeProject?.name?.trim() || workspaceName}
                    projectTooltip={activeProject?.description || activeProject?.defaultDirectory || undefined}
                    placeholder="向 Atrium 提问，继续跟进任务..."
                    draft={draft}
                    setDraft={setDraft}
                    onSend={handleSend}
                    isSending={isSending}
                    souls={souls}
                    activeSoul={activeSoulFolder}
                    onActivateSoul={handleActivateSoul}
                    models={activeProfile?.models ?? []}
                    selectedModel={selectedModel}
                    onSelectModel={setSelectedModel}
                    reasoningEffort={reasoningEffort}
                    onSelectReasoningEffort={handleSelectReasoningEffort}
                    executionMode={executionMode}
                    onSelectExecutionMode={handleSelectExecutionMode}
                  />
                </div>
              </div>
            )}
            {isTerminalOpen && terminals.length > 0 && (
              <TerminalPanel
                terminals={terminals}
                activeId={activeTerminalId ?? terminals[terminals.length - 1]?.id ?? null}
                cwd={terminalCwd}
                onSelect={setActiveTerminalId}
                onCreated={handleTerminalCreated}
                onClosed={handleTerminalClosed}
                onCloseTerminal={handleCloseOneTerminal}
              />
            )}
          </main>
        </div>
      )}

      {/* Project create / settings dialog */}
      {projectDialog && (
        <ProjectDialog
          mode={projectDialog.mode}
          project={
            projectDialog.mode === "edit"
              ? projects.find((p) => p.id === projectDialog.projectId) ?? null
              : null
          }
          fallbackDirectory={workspacePath}
          onClose={() => setProjectDialog(null)}
          onSaved={handleProjectSaved}
        />
      )}

      {/* Souls (persona) manager */}
      {isSoulDialogOpen && (
        <SoulManagerDialog
          souls={souls}
          activeSoul={activeSoulFolder}
          onActivate={handleActivateSoul}
          onChanged={handleSoulsChanged}
          onDeleted={handleSoulDeleted}
          onClose={() => setIsSoulDialogOpen(false)}
        />
      )}

      {/* About / Charter Modal (question-mark button, Ctrl+K) */}
      {isAboutOpen && <AboutDialog onClose={() => setIsAboutOpen(false)} />}
    </div>
  );
}
