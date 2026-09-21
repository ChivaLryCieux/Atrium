import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Project } from "../types/chat";

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
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
};

export function Sidebar({
  userName = "Tempsyche",
  isCollapsed,
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
}: SidebarProps) {
  const { t } = useTranslation();
  const avatarInitial = (userName || "T").trim().charAt(0).toUpperCase();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (projectId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const unassignedTasks = tasks.filter((t) => !t.projectId || !projects.some((p) => p.id === t.projectId));

  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
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
      <div className="sidebar-list-content">
        <div className="list-section-header">{t("sidebar.projectList")}</div>

        {projects.length > 0 ? (
          projects.map((project) => {
            const projectTasks = tasks.filter((t) => t.projectId === project.id);
            const expanded = expandedIds.has(project.id) || activeProjectId === project.id;
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
                  <span className="project-chevron">
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
                </div>

                <div className="project-node-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("sidebar.newTask")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewTask(project.id);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                </div>

                {expanded && (
                  <div className="project-tasks">
                    {projectTasks.length > 0 ? (
                      projectTasks.map((task) => (
                        <div
                          key={task.id}
                          className={`task-item nested ${activeTaskId === task.id ? "active" : ""}`}
                          onClick={() => onSelectTask(task.id)}
                        >
                          <span className="truncate" style={{ maxWidth: "150px" }}>
                            {task.title || t("sidebar.newTaskDefault")}
                          </span>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: "18px", height: "18px", opacity: 0.6 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(task.id);
                            }}
                            title={t("sidebar.deleteTask")}
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="list-empty-item">{t("sidebar.noTasks")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="list-empty-item">{t("sidebar.noProjects")}</div>
        )}

        {/* Sessions that predate any known project (defensive) */}
        {unassignedTasks.length > 0 && (
          <>
            <div className="list-section-header">{t("sidebar.ungrouped")}</div>
            {unassignedTasks.map((task) => (
              <div
                key={task.id}
                className={`task-item ${activeTaskId === task.id ? "active" : ""}`}
                onClick={() => onSelectTask(task.id)}
              >
                <span className="truncate" style={{ maxWidth: "180px" }}>
                  {task.title || t("sidebar.newTaskDefault")}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: "18px", height: "18px", opacity: 0.6 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTask(task.id);
                  }}
                  title={t("sidebar.deleteTask")}
                >
                  ✕
                </button>
              </div>
            ))}
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
    </aside>
  );
}
