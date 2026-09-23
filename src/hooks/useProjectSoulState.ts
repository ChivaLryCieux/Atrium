import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, Project, SessionSummary, Soul } from "../types/chat";
import { dshClient } from "../services/dshClient";

export type ProjectSoulHandlers = {
  handleProjectSaved: (saved: Project) => void;
  handleProjectDeleted: (deletedId: string) => void;
  handleActivateSoul: (folder: string) => void;
  handleSoulsChanged: () => void;
  handleSoulDeleted: (folder: string) => void;
};

/**
 * Project + persona state transitions against the Rust storage layer.
 * Session handlers stay in App until useSendMessage lands (they share its
 * pending-message state). Behavior is a verbatim move — including the
 * backend re-homing sessions of a deleted project into the first
 * remaining project.
 */
export function useProjectSoulState(
  settings: AppSettings | null,
  activeProjectId: string | null,
  activeGitProjectId: string | null,
  activeSoulFolder: string,
  setProjects: Dispatch<SetStateAction<Project[]>>,
  setActiveProjectId: Dispatch<SetStateAction<string | null>>,
  setActiveGitProjectId: Dispatch<SetStateAction<string | null>>,
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>,
  setSouls: Dispatch<SetStateAction<Soul[]>>,
  handleSaveSettings: (next: AppSettings) => void,
): ProjectSoulHandlers {
  // Project dialog save: refresh the list, then pin the saved project.
  const handleProjectSaved = useCallback(
    (saved: Project) => {
      invoke<Project[]>("list_projects")
        .then((list) => {
          setProjects(list);
          setActiveProjectId(saved.id);
        })
        .catch(console.error);
      dshClient.ensureConnected();
    },
    [setProjects, setActiveProjectId],
  );

  // Project dialog delete: the backend re-homed the deleted project's
  // sessions into the first remaining project, so the local session list
  // (project ownership) and the active project both need refreshing; the
  // git panel closes when its project disappears.
  const handleProjectDeleted = useCallback(
    (deletedId: string) => {
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
    },
    [activeProjectId, activeGitProjectId, setProjects, setActiveProjectId, setActiveGitProjectId, setSessions],
  );

  const handleActivateSoul = useCallback(
    (folder: string) => {
      if (settings) {
        handleSaveSettings({ ...settings, activeSoul: folder });
      }
    },
    [settings, handleSaveSettings],
  );

  const handleSoulsChanged = useCallback(() => {
    invoke<Soul[]>("list_souls").then(setSouls).catch(console.error);
  }, [setSouls]);

  const handleSoulDeleted = useCallback(
    (folder: string) => {
      handleSoulsChanged();
      if (folder === activeSoulFolder) {
        handleActivateSoul("Default");
      }
    },
    [handleSoulsChanged, activeSoulFolder, handleActivateSoul],
  );

  return {
    handleProjectSaved,
    handleProjectDeleted,
    handleActivateSoul,
    handleSoulsChanged,
    handleSoulDeleted,
  };
}

