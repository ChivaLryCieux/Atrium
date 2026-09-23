import { useMemo } from "react";
import i18n, { setAppLocale } from "../locales";
import { COMMANDS } from "../commands/registry";
import { normalizeThemeMode, type ThemeMode } from "../themes";

export type CommandActionsDeps = {
  settings: { themeMode?: string | null } | null;
  activeProjectId: string | null;
  onNewTask: () => void;
  onNewProject: () => void;
  onNewTerminal: () => void;
  onOpenSettings: () => void;
  onOpenSouls: () => void;
  onOpenAbout: () => void;
  onToggleSidebar: () => void;
  onToggleGitPanel: (projectId: string) => void;
  onSaveSettings: (next: { themeMode: ThemeMode }) => void;
};

/**
 * Palette action map: a command is offered only when wired and meaningful
 * in the current state (e.g. the git toggle needs an active project).
 */
export function buildCommandActions(deps: CommandActionsDeps): Record<string, () => void> {
  const cycleTheme = () => {
    if (!deps.settings) return;
    const order: ThemeMode[] = ["system", "pure-white", "pure-black", "atrium-color"];
    const current = normalizeThemeMode(deps.settings.themeMode);
    const next = order[(order.indexOf(current) + 1) % order.length];
    deps.onSaveSettings({ themeMode: next });
  };
  const actions: Record<string, () => void> = {
    "new-task": () => deps.onNewTask(),
    "new-project": () => deps.onNewProject(),
    "new-terminal": () => deps.onNewTerminal(),
    "open-settings": () => deps.onOpenSettings(),
    "open-souls": () => deps.onOpenSouls(),
    "open-about": () => deps.onOpenAbout(),
    "toggle-sidebar": () => deps.onToggleSidebar(),
    "toggle-theme": cycleTheme,
    "switch-language": () => setAppLocale(i18n.language === "zh-CN" ? "en" : "zh-CN"),
  };
  if (deps.activeProjectId) {
    const projectId = deps.activeProjectId;
    actions["toggle-git"] = () => deps.onToggleGitPanel(projectId);
  }
  return actions;
}

export function useAvailableCommands(actions: Record<string, () => void>) {
  return useMemo(() => COMMANDS.filter((cmd) => cmd.id in actions), [actions]);
}
