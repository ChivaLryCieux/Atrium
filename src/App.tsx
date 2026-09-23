import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TopBar } from "./components/TopBar";
import { Sidebar, TaskSummary } from "./components/Sidebar";
import { CenterHome } from "./components/CenterHome";
import { PromptCard } from "./components/PromptCard";
import type { TerminalSession } from "./components/TerminalPanel";
import { PanelResizer } from "./components/PanelResizer";
import { StageTelemetryHud } from "./components/StageTelemetryHud";
import { MessageStream } from "./components/MessageStream";
import { useToast } from "./components/Toast";
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
import { generateDefaultTaskTitle } from "./utils/tasks";
import { loadDraft, saveDraft } from "./utils/drafts";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { dshClient } from "./services/dshClient";
import { applyTheme, normalizeThemeMode } from "./themes";
import type { ThemeMode } from "./themes";
import { useTranslation } from "react-i18next";
import i18n, { setAppLocale } from "./locales";
import { COMMANDS, matchesShortcut } from "./commands/registry";

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
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
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

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSessionIdRef = useRef<string | null>(null);
  const isSendingRef = useRef<boolean>(false);
  const tRef = useRef(t);
  tRef.current = t;

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
        // Restore the persisted (provider, model) choice; fall back to the
        // first profile only when nothing was saved (or it was deleted).
        const savedProfile =
          loaded.aiProfiles.find((p) => p.id === loaded.activeProfileId) ??
          loaded.aiProfiles[0];
        if (savedProfile) {
          setActiveProfileId(savedProfile.id);
          setSelectedModel(loaded.selectedModel || savedProfile.model || "");
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
                  const title = firstUser ? firstUser.content.slice(0, 20) : tRef.current("app.legacyTaskTitle");
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
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (chunk.conversationId && active && !chunk.conversationId.startsWith(active)) return;
      if (!chunk.stageId || !chunk.content) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== chunk.stageId || !msg.pending) return msg;
          if (chunk.isReasoning) {
            return {
              ...msg,
              reasoningContent: (msg.reasoningContent || "") + chunk.content,
            };
          }
          const isPlaceholder =
            msg.content === tRef.current("app.thinking") ||
            msg.content.includes(tRef.current("app.stageAnalyzing")) ||
            (msg.content.startsWith("[") && msg.content.includes("]"));
          return { ...msg, content: isPlaceholder ? chunk.content! : msg.content + chunk.content! };
        })
      );
    });

    // Real-time tool call telemetry from kernel
    const unlistenToolEvent = dshClient.onToolEvent((msg) => {
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches) return m;

          const currentTools = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
          if (msg.event.kind === "call") {
            const item = msg.event.item;
            const idx = currentTools.findIndex((t) => t.id === item.id);
            if (idx >= 0) {
              currentTools[idx] = { ...currentTools[idx], ...item };
            } else {
              currentTools.push(item);
            }
          } else if (msg.event.kind === "result") {
            const { callId, result, isError, error, status } = msg.event;
            const idx = currentTools.findIndex((t) => t.id === callId);
            if (idx >= 0) {
              currentTools[idx] = {
                ...currentTools[idx],
                result,
                isError,
                error,
                status,
              };
            } else {
              currentTools.push({
                id: callId,
                name: "tool",
                arguments: "",
                result,
                isError,
                error,
                status,
                timestamp: Date.now(),
              });
            }
          }
          return { ...m, toolCalls: currentTools };
        })
      );
    });

    // Real-time token usage telemetry from kernel
    const unlistenTokenUsage = dshClient.onTokenUsage((msg) => {
      if (isSendingRef.current) return;
      const usage = msg.usage;
      if (!usage) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches) return m;
          // 词元计量只增不减：内核的 attempt/重试或子步骤通知可能乱序到达
          // 且用量更小，直接覆写会让计数器回落。按字段取高水位。
          return {
            ...m,
            promptTokens: Math.max(m.promptTokens ?? 0, usage.inputTokens),
            completionTokens: Math.max(m.completionTokens ?? 0, usage.outputTokens),
          };
        })
      );
    });

    // Real-time agent status telemetry from kernel
    const unlistenAgentStatus = dshClient.onAgentStatus((msg) => {
      if (isSendingRef.current) return;
      const active = activeSessionIdRef.current;
      if (msg.conversationId && active && !msg.conversationId.startsWith(active)) return;
      setMessages((prev) =>
        prev.map((m) => {
          const matches = msg.stageId ? m.id === msg.stageId : m.pending && m.role === "assistant";
          if (!matches || !m.pending) return m;
          return {
            ...m,
            statusDetail: msg.detail,
          };
        })
      );
    });

    return () => {
      unlistenStream();
      unlistenToolEvent();
      unlistenTokenUsage();
      unlistenAgentStatus();
    };
  }, []);

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

  // ── Composer drafts: per-session persistence ─────────────────
  // Switching sessions swaps in that session's stored draft (the greeting
  // stage shares one bucket), edits persist debounced. The save effect
  // re-arms on every (draft, session) change, so the transient render right
  // after a session switch (old text, new key) never flushes a wrong value.
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setDraft(loadDraft(activeSessionId));
  }, [activeSessionId]);

  useEffect(() => {
    if (draftTimerRef.current !== undefined) {
      clearTimeout(draftTimerRef.current);
    }
    draftTimerRef.current = setTimeout(() => {
      saveDraft(activeSessionId, draft);
    }, 300);
    return () => {
      if (draftTimerRef.current !== undefined) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [draft, activeSessionId]);

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

  // ── Project dialog save ──────────────────────────────────────
  const handleProjectSaved = (saved: Project) => {
    invoke<Project[]>("list_projects")
      .then((list) => {
        setProjects(list);
        setActiveProjectId(saved.id);
      })
      .catch(console.error);
  };

  // ── Project dialog delete ────────────────────────────────────
  // The backend re-homed the deleted project's sessions into the first
  // remaining project, so the local session list (project ownership) and
  // the active project both need refreshing; the git panel closes when its
  // project disappears.
  const handleProjectDeleted = (deletedId: string) => {
    invoke<Project[]>("list_projects")
      .then((list) => {
        setProjects(list);
        if (activeProjectId === deletedId) {
          setActiveProjectId(list[0]?.id ?? null);
        }
        if (activeGitProjectId === deletedId) {
          setActiveGitProjectId(null);
        }
        invoke<SessionSummary[]>("list_sessions")
          .then(setSessions)
          .catch(console.error);
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

  // ── Send Message ─────────────────────────────────────────────
  const handleSend = async () => {
    if (!draft.trim() || !activeProfile || !settings || isSending) return;

    let curSessionId = activeSessionId;
    if (!curSessionId) {
      try {
        const title = generateDefaultTaskTitle(sessions, activeProjectId, t);
        const created = await invoke<SessionSummary>("create_session", {
          title,
          projectId: activeProjectId,
        });
        curSessionId = created.id;
        setActiveSessionId(curSessionId);
        setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      } catch (err) {
        console.error(t("app.createSessionFailed"), err);
      }
    }

    if (curSessionId) {
      activeSessionIdRef.current = curSessionId;
    }
    dshClient.ensureConnected();

    const userMessage = createUserMessage(draft.trim(), settings.userName || "Tempsyche");
    const baseMessages = [...messages, userMessage];

    // One pending bubble per pipeline node; its id equals the stage id so the
    // kernel's streamed deltas and settled replies land in the same node.
    // Single mode has exactly one deterministic node id (`<profile>-single`,
    // mirroring the backend), so streaming matches without a random UUID.
    const isSingleMode = settings.orchestrationMode === "single";
    const pendingMessages: PendingMessage[] = isSingleMode
      ? [
          {
            id: `${activeProfile.id}-single`,
            role: "assistant" as const,
            content: t("app.thinking"),
            speakerId: activeProfile.id,
            speakerName: activeProfile.name,
            avatar: activeProfile.avatar,
            pending: true as const,
          },
        ]
      : orchestrationStages.length > 0
        ? orchestrationStages.map((stage) => ({
            id: stage.id,
            role: "assistant" as const,
            content: t("app.thinking"),
            speakerId: stage.profile.id,
            speakerName: `${stage.title} · ${stage.profile.name}`,
            avatar: stage.profile.avatar,
            pending: true as const,
          }))
        : createPendingMessages([activeProfile]);

    setDraft("");
    isSendingRef.current = true;
    setIsSending(true);
    setMessages([...baseMessages, ...pendingMessages]);

    let unlistenProgress: (() => void) | null = null;
    let unlistenStreamEvent: (() => void) | null = null;

    try {
      unlistenProgress = await listen<OrchestrationProgressEvent>(
        "orchestration-progress",
        (event) => {
          const { stageId, stageTitle, status: eventStatus } = event.payload;
          if (eventStatus === "running") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.pending && (!stageId || msg.id === stageId) && msg.content === t("app.thinking")
                  ? { ...msg, content: `[${stageTitle}] ${t("app.stageAnalyzing")}` }
                  : msg
              )
            );
          }
        }
      );

      // Real-time stream direct from kernel via Rust SSE pipe
      unlistenStreamEvent = await listen<any>("kernel-stream-event", (event) => {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;

        const active = activeSessionIdRef.current;
        if (payload.conversationId && active && !payload.conversationId.startsWith(active)) return;

        if (payload.type === "assistant-stream") {
          const { stageId, content, isReasoning } = payload;
          if (!content) return;
          setMessages((prev) =>
            prev.map((msg) => {
              const matches = stageId ? msg.id === stageId : msg.pending && msg.role === "assistant";
              if (!matches || !msg.pending) return msg;
              if (isReasoning) {
                return {
                  ...msg,
                  reasoningContent: (msg.reasoningContent || "") + content,
                };
              }
              const isPlaceholder =
                msg.content === tRef.current("app.thinking") ||
                msg.content.includes(tRef.current("app.stageAnalyzing")) ||
                (msg.content.startsWith("[") && msg.content.includes("]"));
              return { ...msg, content: isPlaceholder ? content : msg.content + content };
            })
          );
        } else if (payload.type === "tool-event") {
          const { stageId, event: toolEvt } = payload;
          if (!toolEvt) return;
          setMessages((prev) =>
            prev.map((m) => {
              const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
              if (!matches) return m;

              const currentTools = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
              if (toolEvt.kind === "call") {
                const item = toolEvt.item;
                const idx = currentTools.findIndex((t) => t.id === item.id);
                if (idx >= 0) {
                  currentTools[idx] = { ...currentTools[idx], ...item };
                } else {
                  currentTools.push(item);
                }
              } else if (toolEvt.kind === "result") {
                const { callId, result, isError, error, status } = toolEvt;
                const idx = currentTools.findIndex((t) => t.id === callId);
                if (idx >= 0) {
                  currentTools[idx] = { ...currentTools[idx], result, isError, error, status };
                } else {
                  currentTools.push({
                    id: callId,
                    name: "tool",
                    arguments: "",
                    result,
                    isError,
                    error,
                    status,
                    timestamp: Date.now(),
                  });
                }
              }
              return { ...m, toolCalls: currentTools };
            })
          );
        } else if (payload.type === "token-usage") {
          const { stageId, usage } = payload;
          if (!usage) return;
          setMessages((prev) =>
            prev.map((m) => {
              const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
              if (!matches) return m;
              // 同 WS 监听：乱序的小额用量通知不得让计量回落。
              return {
                ...m,
                promptTokens: Math.max(m.promptTokens ?? 0, usage.inputTokens),
                completionTokens: Math.max(m.completionTokens ?? 0, usage.outputTokens),
              };
            })
          );
        } else if (payload.type === "agent-status") {
          const { stageId, detail } = payload;
          if (!detail) return;
          setMessages((prev) =>
            prev.map((m) => {
              const matches = stageId ? m.id === stageId : m.pending && m.role === "assistant";
              if (!matches || !m.pending) return m;
              return { ...m, statusDetail: detail };
            })
          );
        }
      });

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

      if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
      }
      if (unlistenStreamEvent) {
        unlistenStreamEvent();
        unlistenStreamEvent = null;
      }
      setMessages((prev) => {
        const mergedReplies = finalReplies.map((reply) => {
          const pending = prev.find((m) => m.id === reply.id);
          const toolCalls =
            reply.toolCalls && reply.toolCalls.length > 0
              ? reply.toolCalls
              : pending?.toolCalls ?? null;
          // 结算合并同样走高水位：回复载荷若缺失/小于流式期间已记录的
          // 内核精确值，保留较大者，避免「落定瞬间数字回落」。
          const promptTokens =
            Math.max(reply.promptTokens ?? 0, pending?.promptTokens ?? 0) || null;
          const completionTokens =
            Math.max(reply.completionTokens ?? 0, pending?.completionTokens ?? 0) || null;
          const reasoningContent = reply.reasoningContent || pending?.reasoningContent || null;
          return {
            ...reply,
            toolCalls,
            promptTokens,
            completionTokens,
            reasoningContent,
          };
        });
        const updatedMessages = [...baseMessages, ...mergedReplies];
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
        return updatedMessages;
      });
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.pending
            ? {
                ...msg,
                content: `${t("app.dispatchError")} ${String(error)}`,
                pending: false,
                error: true,
              }
            : msg
        )
      );
    } finally {
      if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
      }
      if (unlistenStreamEvent) {
        unlistenStreamEvent();
        unlistenStreamEvent = null;
      }
      isSendingRef.current = false;
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
  const commandActions = useMemo<Record<string, () => void>>(() => {
    const cycleTheme = () => {
      if (!settings) return;
      const order: ThemeMode[] = ["system", "pure-white", "pure-black", "atrium-color"];
      const current = normalizeThemeMode(settings.themeMode);
      const next = order[(order.indexOf(current) + 1) % order.length];
      void handleSaveSettings({ ...settings, themeMode: next });
    };
    const actions: Record<string, () => void> = {
      "new-task": () => {
        void handleNewTask();
      },
      "new-project": () => setProjectDialog({ mode: "create" }),
      "new-terminal": handleNewTerminal,
      "open-settings": () => setCurrentView("settings"),
      "open-souls": () => setIsSoulDialogOpen(true),
      "open-about": () => setIsAboutOpen(true),
      "toggle-sidebar": () => setIsSidebarCollapsed((prev) => !prev),
      "toggle-theme": cycleTheme,
      "switch-language": () => setAppLocale(i18n.language === "zh-CN" ? "en" : "zh-CN"),
    };
    if (activeProjectId) {
      actions["toggle-git"] = () =>
        setActiveGitProjectId((cur) => (cur === activeProjectId ? null : activeProjectId));
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, activeProjectId, handleNewTask]);

  const availableCommands = useMemo(
    () => COMMANDS.filter((cmd) => cmd.id in commandActions),
    [commandActions],
  );

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
