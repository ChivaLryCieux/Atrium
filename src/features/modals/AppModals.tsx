import React, { Suspense, lazy } from "react";
import { Project, Soul } from "../../types/chat";
import type { ProjectDeletionResult } from "../../services/projectApi";
import type { useAvailableCommands } from "../../hooks/useCommandActions";

const ProjectDialog = lazy(() => import("../../components/ProjectDialog").then((m) => ({ default: m.ProjectDialog })));
const SoulManagerDialog = lazy(() =>
  import("../../components/SoulManagerDialog").then((m) => ({ default: m.SoulManagerDialog })),
);
const PluginManagerDialog = lazy(() =>
  import("../../components/PluginManagerDialog").then((m) => ({ default: m.PluginManagerDialog })),
);
const AboutDialog = lazy(() => import("../../components/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const CommandPalette = lazy(() => import("../../components/CommandPalette").then((m) => ({ default: m.CommandPalette })));

export interface AppModalsProps {
  projectDialog: { mode: "create" | "edit"; projectId?: string } | null;
  setProjectDialog: (v: { mode: "create" | "edit"; projectId?: string } | null) => void;
  projects: Project[];
  workspacePath: string;
  onProjectSaved: (project: Project) => void;
  onProjectDeleted: (projectId: string, result: ProjectDeletionResult) => void;

  isSoulDialogOpen: boolean;
  setIsSoulDialogOpen: (v: boolean) => void;
  isPluginDialogOpen: boolean;
  setIsPluginDialogOpen: (v: boolean) => void;
  souls: Soul[];
  activeSoulFolder: string;
  onActivateSoul: (name: string) => void;
  onSoulsChanged: () => void;
  onSoulDeleted: (name: string) => void;

  isAboutOpen: boolean;
  setIsAboutOpen: (v: boolean) => void;

  isPaletteOpen: boolean;
  setIsPaletteOpen: (v: boolean) => void;
  availableCommands: ReturnType<typeof useAvailableCommands>;
  paletteTasks: { id: string; title: string; projectName?: string }[];
  activeSessionId: string | null;
  activeProjectId: string | null;
  commandActions: Record<string, () => void>;
  onSelectTask: (id: string) => void;
  onSelectProject: (id: string) => void;
}

export const AppModals: React.FC<AppModalsProps> = ({
  projectDialog,
  setProjectDialog,
  projects,
  workspacePath,
  onProjectSaved,
  onProjectDeleted,
  isSoulDialogOpen,
  setIsSoulDialogOpen,
  isPluginDialogOpen,
  setIsPluginDialogOpen,
  souls,
  activeSoulFolder,
  onActivateSoul,
  onSoulsChanged,
  onSoulDeleted,
  isAboutOpen,
  setIsAboutOpen,
  isPaletteOpen,
  setIsPaletteOpen,
  availableCommands,
  paletteTasks,
  activeSessionId,
  activeProjectId,
  commandActions,
  onSelectTask,
  onSelectProject,
}) => {
  return (
    <>
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
            onSaved={onProjectSaved}
            onDeleted={onProjectDeleted}
          />
        </Suspense>
      )}

      {/* Souls (persona) manager */}
      {isSoulDialogOpen && (
        <Suspense fallback={null}>
          <SoulManagerDialog
            souls={souls}
            activeSoul={activeSoulFolder}
            onActivate={onActivateSoul}
            onChanged={onSoulsChanged}
            onDeleted={onSoulDeleted}
            onClose={() => setIsSoulDialogOpen(false)}
          />
        </Suspense>
      )}

      {/* DSH Plugins (Plugin & Bundle) Manager */}
      {isPluginDialogOpen && (
        <Suspense fallback={null}>
          <PluginManagerDialog onClose={() => setIsPluginDialogOpen(false)} />
        </Suspense>
      )}

      {/* About / Charter Modal */}
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
            onSelectTask={onSelectTask}
            onSelectProject={onSelectProject}
          />
        </Suspense>
      )}
    </>
  );
};
