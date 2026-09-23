import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Project } from "../types/chat";
import { AppDialog, AppDialogRequest } from "./AppDialog";

export type TaskSummary = {
  id: string;
  title: string;
  timestamp?: number;
  projectId?: string | null;
};

type SidebarProps = {
  userName: string;
  isCollapsed: boolean;
  onOpenSettings: () => void;
  onOpenSouls: () => void;
  projects: Project[];
  tasks: TaskSummary[];
  activeTaskId?: string;
  activeProjectId?: string | null;
  activeGitProjectId?: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onNewTask: (projectId: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
  onToggleGitPanel?: (projectId: string) => void;
  width?: number;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onRenameTask?: (id: string, newTitle: string) => void;
};

export function Sidebar({
  userName = "Tempsyche",
  isCollapsed,
  width,
  onOpenSettings,
  onOpenSouls,
  projects,
  tasks,
  activeTaskId,
  activeProjectId,
  activeGitProjectId,
  onSelectProject,
  onNewProject,
  onNewTask,
  onOpenProjectSettings,
  onToggleGitPanel,
  onSelectTask,
  onDeleteTask,
  onRenameTask,
}: SidebarProps) {
  const { t } = useTranslation();
  const avatarInitial = (userName || "T").trim().charAt(0).toUpperCase();

  // Delete confirmation dialog state
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);

  // Inline rename state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const startRenaming = (task: TaskSummary) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title || "");
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 50);
  };

  const commitRename = (taskId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && onRenameTask) {
      onRenameTask(taskId, trimmed);
    }
    setEditingTaskId(null);
  };

  const handleDeleteClick = (task: TaskSummary) => {
    setDialog({
      kind: "confirm",
      title: t("common.hint"),
      message: t("sidebar.confirmDeleteTask"),
      tone: "danger",
      onConfirm: () => {
        onDeleteTask(task.id);
      },
    });
  };

  // Initialize expanded set with existing projects & activeProjectId
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    projects.forEach((p) => initial.add(p.id));
    if (activeProjectId) initial.add(activeProjectId);
    return initial;
  });

  // Auto-expand projects when they are first loaded
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && projects.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        projects.forEach((p) => next.add(p.id));
        return next;
      });
      initializedRef.current = true;
    }
  }, [projects]);

  // Expand when switching to a different project from the outside (e.g. creating a new project/session)
  const prevActiveRef = useRef(activeProjectId);
  useEffect(() => {
    if (activeProjectId && activeProjectId !== prevActiveRef.current) {
      setExpandedIds((prev) => {
        if (prev.has(activeProjectId)) return prev;
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
      prevActiveRef.current = activeProjectId;
    }
  }, [activeProjectId]);

  const toggleExpanded = (projectId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const unassignedTasks = tasks.filter((t) => !t.projectId || !projects.some((p) => p.id === t.projectId));

  // ── Filter (project / task quick find) ───────────────────────
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const taskMatches = (task: TaskSummary) =>
    !query ||
    (task.title || "").toLowerCase().includes(query) ||
    (projects.find((p) => p.id === task.projectId)?.name ?? "").toLowerCase().includes(query);
  const visibleProjects = query
    ? projects.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(query) ||
          tasks.some((task) => task.projectId === p.id && taskMatches(task)),
      )
    : projects;
  const visibleUnassigned = query ? unassignedTasks.filter(taskMatches) : unassignedTasks;
  const hasFilterResults = visibleProjects.length > 0 || visibleUnassigned.length > 0;

  const renderTaskItem = (task: TaskSummary, isNested: boolean) => {
    const isEditing = editingTaskId === task.id;
    return (
      <div
        key={task.id}
        className={`task-item ${isNested ? "nested" : ""} ${activeTaskId === task.id ? "active" : ""}`}
        onClick={() => {
          if (!isEditing) onSelectTask(task.id);
        }}
      >
        {isEditing ? (
          <input
            ref={renameInputRef}
            type="text"
            className="task-rename-input"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename(task.id);
              } else if (e.key === "Escape") {
                setEditingTaskId(null);
              }
            }}
            onBlur={() => commitRename(task.id)}
            autoFocus
          />
        ) : (
          <span
            className="truncate task-title"
            title={task.title || t("sidebar.newTaskDefault")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRenaming(task);
            }}
          >
            {task.title || t("sidebar.newTaskDefault")}
          </span>
        )}

        <div className="task-actions" onClick={(e) => e.stopPropagation()}>
          {!isEditing && (
            <button
              type="button"
              className="icon-btn task-action-btn rename"
              onClick={(e) => {
                e.stopPropagation();
                startRenaming(task);
              }}
              title={t("sidebar.renameTask")}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="icon-btn task-action-btn delete"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick(task);
            }}
            title={t("sidebar.deleteTask")}
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside
      className={`sidebar ${isCollapsed ? "collapsed" : ""}`}
      style={!isCollapsed && width ? { width: `${width}px` } : undefined}
    >
      {/* Top Actions: Settings above New Project */}
      <div className="sidebar-top-actions">
        <button type="button" className="action-row" onClick={onOpenSettings} title={t("sidebar.settings")}>
          <div className="action-left">
            <span className="action-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span>{t("sidebar.settings")}</span>
          </div>
        </button>

        <button type="button" className="action-row" onClick={onOpenSouls} title={t("sidebar.souls")}>
          <div className="action-left">
            <span className="action-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                <path d="M19 15l.9 2.4L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.6z" />
              </svg>
            </span>
            <span>{t("sidebar.souls")}</span>
          </div>
        </button>

        <button type="button" className="action-row" onClick={onNewProject} title={t("sidebar.newProject")}>
          <div className="action-left">
            <span className="action-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </span>
            <span>{t("sidebar.newProject")}</span>
          </div>
        </button>
      </div>

      {/* Project Tree: static label + expandable folders */}
      <div className="sidebar-filter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          className="sidebar-filter-input"
          value={filter}
          placeholder={t("sidebar.filterPlaceholder")}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            type="button"
            className="sidebar-filter-clear"
            title={t("sidebar.filterClear")}
            onClick={() => setFilter("")}
          >
            ✕
          </button>
        )}
      </div>

      <div className="sidebar-list-content">
        <div className="list-section-header">{t("sidebar.projectList")}</div>

        {!hasFilterResults && query && <div className="list-empty-item">{t("sidebar.noMatch")}</div>}

        {visibleProjects.length > 0 ? (
          visibleProjects.map((project) => {
            const projectTasks = tasks.filter((t) => t.projectId === project.id);
            // While filtering, matched groups are force-expanded so results
            // are visible without extra clicks.
            const expanded = query ? true : expandedIds.has(project.id);
            return (
              <div key={project.id} className="project-node">
                <div
                  className={`project-node-row ${activeProjectId === project.id ? "active" : ""}`}
                  onClick={() => {
                    onSelectProject(project.id);
                    toggleExpanded(project.id);
                  }}
                  title={project.description || project.name}
                >
                  <span
                    className="project-chevron"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(project.id);
                    }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                  <span className="project-folder-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <span className="truncate project-name">{project.name || t("sidebar.untitledProject")}</span>

                  <div className="project-node-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("sidebar.newTask")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewTask(project.id);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`icon-btn ${activeGitProjectId === project.id ? "active" : ""}`}
                      title={t("sidebar.sourceControl")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleGitPanel?.(project.id);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="18" r="3" />
                        <circle cx="6" cy="6" r="3" />
                        <path d="M18 6v6a2 2 0 0 1-2 2H8" />
                        <path d="M6 9v12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("sidebar.projectSettings")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProjectSettings(project.id);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="project-tasks">
                    {projectTasks.some(taskMatches) ? (
                      projectTasks.filter(taskMatches).map((task) => renderTaskItem(task, true))
                    ) : (
                      <div className="list-empty-item">{t("sidebar.noTasks")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          !query && <div className="list-empty-item">{t("sidebar.noProjects")}</div>
        )}

        {/* Sessions that predate any known project (defensive) */}
        {visibleUnassigned.length > 0 && (
          <>
            <div className="list-section-header">{t("sidebar.ungrouped")}</div>
            {visibleUnassigned.map((task) => renderTaskItem(task, false))}
          </>
        )}
      </div>

      {/* Footer: User Profile */}
      <div className="sidebar-footer">
        <div className="user-profile-info" onClick={onOpenSettings} title={t("sidebar.userProfile")}>
          <div className="user-avatar-circle">{avatarInitial}</div>
          <span className="user-name-text">{userName || "Tempsyche"}</span>
        </div>
      </div>

      {/* Delete Task Confirmation Dialog */}
      {dialog && <AppDialog request={dialog} onClose={() => setDialog(null)} />}
    </aside>
  );
}
