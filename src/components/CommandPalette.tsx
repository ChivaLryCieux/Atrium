import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandDefinition, formatShortcut } from "../commands/registry";

export type PaletteTask = {
  id: string;
  title: string;
  projectName?: string;
};

export type PaletteProject = {
  id: string;
  name: string;
};

type CommandPaletteProps = {
  onClose: () => void;
  /// Commands offered by the palette — availability is decided by the caller
  /// (a command stays out until its action is wired and meaningful).
  commands: CommandDefinition[];
  tasks: PaletteTask[];
  projects: PaletteProject[];
  activeTaskId?: string | null;
  activeProjectId?: string | null;
  onRunCommand: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectProject: (id: string) => void;
};

type PaletteItem =
  | { kind: "command"; key: string; def: CommandDefinition }
  | { kind: "task"; key: string; task: PaletteTask }
  | { kind: "project"; key: string; project: PaletteProject };

const MAX_TASKS = 6;
const MAX_PROJECTS = 4;

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * Command-center style overlay: fuzzy-ish (substring) search over commands,
 * tasks and projects, with full keyboard navigation. Mirrors the ZCode
 * CommandCenter pattern, trimmed for the single-window desktop harness.
 */
export function CommandPalette({
  onClose,
  commands,
  tasks,
  projects,
  activeTaskId,
  activeProjectId,
  onRunCommand,
  onSelectTask,
  onSelectProject,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const commandEntries = useMemo(
    () =>
      commands.map((def) => ({
        def,
        title: t(def.titleKey),
        haystack: [def.id, def.titleKey, t(def.titleKey), ...(def.keywords ?? [])]
          .join(" ")
          .toLowerCase(),
      })),
    [commands, t],
  );

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedCommands = q
      ? commandEntries.filter((entry) => contains(entry.haystack, q))
      : commandEntries;
    const matchedTasks = (
      q ? tasks.filter((task) => contains(task.title, q) || contains(task.projectName ?? "", q)) : tasks
    ).slice(0, MAX_TASKS);
    const matchedProjects = (
      q ? projects.filter((project) => contains(project.name, q)) : projects
    ).slice(0, MAX_PROJECTS);

    return { matchedCommands, matchedTasks, matchedProjects };
  }, [query, commandEntries, tasks, projects]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    for (const entry of sections.matchedCommands) {
      list.push({ kind: "command", key: `cmd:${entry.def.id}`, def: entry.def });
    }
    for (const task of sections.matchedTasks) {
      list.push({ kind: "task", key: `task:${task.id}`, task });
    }
    for (const project of sections.matchedProjects) {
      list.push({ kind: "project", key: `prj:${project.id}`, project });
    }
    return list;
  }, [sections]);

  // Reset the cursor whenever the result set changes so Enter always fires
  // the first visible entry (VS Code behavior).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length]);

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === "command") onRunCommand(item.def.id);
    else if (item.kind === "task") onSelectTask(item.task.id);
    else onSelectProject(item.project.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (items.length === 0 ? 0 : (prev - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[activeIndex]);
    }
  };

  const renderShortcut = (def: CommandDefinition) =>
    def.shortcut ? <kbd className="palette-kbd">{formatShortcut(def.shortcut)}</kbd> : null;

  const hasResults = items.length > 0;

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette-dialog"
        role="dialog"
        aria-label={t("command.paletteTitle")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
          </svg>
          <input
            className="palette-input"
            autoFocus
            value={query}
            placeholder={t("command.inputPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="palette-kbd">Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef}>
          {!hasResults && <div className="palette-empty">{t("command.noResults")}</div>}

          {sections.matchedCommands.length > 0 && (
            <>
              <div className="palette-section-header">{t("command.sectionCommands")}</div>
              {sections.matchedCommands.map((entry) => {
                const index = items.findIndex(
                  (candidate) => candidate.kind === "command" && candidate.def.id === entry.def.id,
                );
                return (
                  <button
                    type="button"
                    key={entry.def.id}
                    className={`palette-item ${index === activeIndex ? "active" : ""}`}
                    data-active={index === activeIndex ? "true" : "false"}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runItem(items[index])}
                  >
                    <span className="palette-item-title">{entry.title}</span>
                    {renderShortcut(entry.def)}
                  </button>
                );
              })}
            </>
          )}

          {sections.matchedTasks.length > 0 && (
            <>
              <div className="palette-section-header">{t("command.sectionTasks")}</div>
              {sections.matchedTasks.map((task) => {
                const index = items.findIndex(
                  (candidate) => candidate.kind === "task" && candidate.task.id === task.id,
                );
                return (
                  <button
                    type="button"
                    key={task.id}
                    className={`palette-item ${index === activeIndex ? "active" : ""}`}
                    data-active={index === activeIndex ? "true" : "false"}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runItem(items[index])}
                  >
                    <span className="palette-item-title">
                      {task.title || t("sidebar.newTaskDefault")}
                      {activeTaskId === task.id && <span className="palette-badge">{t("command.activeBadge")}</span>}
                    </span>
                    {task.projectName && <span className="palette-item-meta">{task.projectName}</span>}
                  </button>
                );
              })}
            </>
          )}

          {sections.matchedProjects.length > 0 && (
            <>
              <div className="palette-section-header">{t("command.sectionProjects")}</div>
              {sections.matchedProjects.map((project) => {
                const index = items.findIndex(
                  (candidate) => candidate.kind === "project" && candidate.project.id === project.id,
                );
                return (
                  <button
                    type="button"
                    key={project.id}
                    className={`palette-item ${index === activeIndex ? "active" : ""}`}
                    data-active={index === activeIndex ? "true" : "false"}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runItem(items[index])}
                  >
                    <span className="palette-item-title">
                      {project.name || t("sidebar.untitledProject")}
                      {activeProjectId === project.id && <span className="palette-badge">{t("command.activeBadge")}</span>}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="palette-footer">
          <span><kbd className="palette-kbd">↑</kbd><kbd className="palette-kbd">↓</kbd> {t("command.hintNavigate")}</span>
          <span><kbd className="palette-kbd">Enter</kbd> {t("command.hintRun")}</span>
          <span><kbd className="palette-kbd">Esc</kbd> {t("command.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
