/**
 * Atrium // Unified command registry
 *
 * Single source of truth for command-palette entries and the shortcut
 * cheat-sheet in settings. Definitions stay pure data (i18n keys + display
 * shortcut specs); the actions themselves live in App.tsx because they need
 * live state (active session, theme, locale, …). A command without a wired
 * action is simply not offered — availability follows the action map.
 */

export type CommandGroup = "app" | "session" | "view" | "navigate";

export type CommandDefinition = {
  id: string;
  titleKey: string;
  group: CommandGroup;
  /// Display-only spec, e.g. "Ctrl+N". "CmdOrCtrl" renders as "Ctrl" on
  /// Windows/Linux via {@link formatShortcut}.
  shortcut?: string;
  /// Extra filter terms (English aliases, pinyin-free synonyms).
  keywords?: string[];
};

export function formatShortcut(spec: string): string {
  return spec.replace(/CmdOrCtrl/g, "Ctrl");
}

export const COMMANDS: CommandDefinition[] = [
  {
    id: "new-task",
    titleKey: "command.newTask",
    group: "session",
    shortcut: "Ctrl+N",
    keywords: ["task", "session", "xinjian"],
  },
  {
    id: "new-project",
    titleKey: "command.newProject",
    group: "session",
    keywords: ["project", "xiangmu"],
  },
  {
    id: "new-terminal",
    titleKey: "command.newTerminal",
    group: "view",
    keywords: ["terminal", "zhongduan", "shell"],
  },
  {
    id: "open-settings",
    titleKey: "command.openSettings",
    group: "app",
    keywords: ["settings", "shezhi", "preferences"],
  },
  {
    id: "open-souls",
    titleKey: "command.openSouls",
    group: "app",
    keywords: ["soul", "persona", "renge"],
  },
  {
    id: "open-about",
    titleKey: "command.openAbout",
    group: "app",
    keywords: ["about", "charter", "guanyu", "xianzhang"],
  },
  {
    id: "toggle-sidebar",
    titleKey: "command.toggleSidebar",
    group: "view",
    keywords: ["sidebar", "cebian", "collapse"],
  },
  {
    id: "toggle-git",
    titleKey: "command.toggleGit",
    group: "view",
    keywords: ["git", "source", "yuanma", "diff"],
  },
  {
    id: "toggle-theme",
    titleKey: "command.toggleTheme",
    group: "app",
    keywords: ["theme", "zhuti", "dark", "light"],
  },
  {
    id: "switch-language",
    titleKey: "command.switchLanguage",
    group: "app",
    keywords: ["language", "locale", "yuyan", "i18n"],
  },
];

/**
 * Matches a display spec like "Ctrl+Shift+P" against a keyboard event.
 * `CmdOrCtrl` accepts either platform's primary modifier so the same spec
 * works on macOS (metaKey) and Windows/Linux (ctrlKey).
 */
export function matchesShortcut(event: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+").map((part) => part.trim());
  const key = (parts.pop() ?? "").toLowerCase();
  const needCtrl = parts.some((m) => {
    const mod = m.toLowerCase();
    return mod === "cmdorctrl" || mod === "ctrl";
  });
  const needShift = parts.some((m) => m.toLowerCase() === "shift");
  const needAlt = parts.some((m) => m.toLowerCase() === "alt");
  const primary = event.ctrlKey || event.metaKey;
  if (needCtrl !== primary) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
  return event.key.toLowerCase() === key || event.code.toLowerCase() === key;
}
