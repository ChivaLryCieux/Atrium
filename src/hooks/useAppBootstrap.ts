import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ChatMessage,
  ExecutionMode,
  Project,
  ReasoningEffort,
  SessionSummary,
  Soul,
} from "../types/chat";
import { dshClient } from "../services/dshClient";

export type AppBootstrapSetters = {
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  setActiveProfileId: Dispatch<SetStateAction<string>>;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  setExecutionMode: Dispatch<SetStateAction<ExecutionMode>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setWorkspacePath: Dispatch<SetStateAction<string>>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  setSouls: Dispatch<SetStateAction<Soul[]>>;
};

/**
 * One-shot startup fan-in: settings, sessions (+legacy-history fallback),
 * workspace path, projects, souls, and the background dsh daemon init.
 * Runs once; streaming subscriptions live in useKernelStreams.
 */
export function useAppBootstrap(setters: AppBootstrapSetters, tRef: MutableRefObject<(k: string) => string>) {
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => {
        // Ensure default username is Tempsyche if empty
        if (!loaded.userName || loaded.userName === "OPERATOR") {
          loaded.userName = "Tempsyche";
        }
        setters.setSettings(loaded);
        // Restore the persisted (provider, model) choice; fall back to the
        // first profile only when nothing was saved (or it was deleted).
        const savedProfile =
          loaded.aiProfiles.find((p) => p.id === loaded.activeProfileId) ??
          loaded.aiProfiles[0];
        if (savedProfile) {
          setters.setActiveProfileId(savedProfile.id);
          setters.setSelectedModel(loaded.selectedModel || savedProfile.model || "");
        }
        if (loaded.reasoningEffort) {
          // The UI offers three tiers; legacy "off" normalizes to 低耗推理.
          setters.setReasoningEffort(loaded.reasoningEffort === "off" ? "low" : loaded.reasoningEffort);
        }
        if (loaded.executionMode) {
          setters.setExecutionMode(loaded.executionMode);
        }
      })
      .catch(console.error);

    invoke<SessionSummary[]>("list_sessions")
      .then((sessionList) => {
        if (sessionList && sessionList.length > 0) {
          setters.setSessions(sessionList);
          const first = sessionList[0];
          setters.setActiveSessionId(first.id);
          invoke<ChatMessage[]>("load_session_messages", { sessionId: first.id })
            .then((loadedMsgs) => {
              if (loadedMsgs && loadedMsgs.length > 0) setters.setMessages(loadedMsgs);
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
                  setters.setSessions([created]);
                  setters.setActiveSessionId(created.id);
                  setters.setMessages(cached);
                } catch {
                  setters.setMessages(cached);
                }
              }
            })
            .catch(console.error);
        }
      })
      .catch(console.error);

    invoke<string>("get_default_workspace_path")
      .then(setters.setWorkspacePath)
      .catch(console.error);

    // Projects (creates the default project and migrates legacy sessions)
    invoke<Project[]>("list_projects")
      .then((list) => {
        setters.setProjects(list);
        if (list.length > 0) setters.setActiveProjectId(list[0].id);
      })
      .catch(console.error);

    // Personas (creates Souls/Default/SOUL.md on first run)
    invoke<Soul[]>("list_souls").then(setters.setSouls).catch(console.error);

    // Initialize DSH daemon client in background
    dshClient.init().catch(console.error);
    // Setters are React-stable; tRef is a stable container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
