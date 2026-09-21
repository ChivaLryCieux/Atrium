import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Project, ProjectUsageStats } from "../types/chat";

type ProjectDialogProps = {
  mode: "create" | "edit";
  project?: Project | null;
  fallbackDirectory?: string;
  onClose: () => void;
  onSaved: (project: Project) => void;
};

export function ProjectDialog({ mode, project, fallbackDirectory, onClose, onSaved }: ProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [directories, setDirectories] = useState<string[]>(
    project?.directories ?? (fallbackDirectory ? [fallbackDirectory] : [])
  );
  const [defaultDirectory, setDefaultDirectory] = useState<string | null>(
    project?.defaultDirectory ?? fallbackDirectory ?? null
  );
  const [stats, setStats] = useState<ProjectUsageStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && project) {
      invoke<ProjectUsageStats>("get_project_token_stats", { projectId: project.id })
        .then(setStats)
        .catch(console.error);
    }
  }, [mode, project]);

  const handleAddDirectory = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: t("project.chooseWorkspace") });
      if (typeof picked === "string" && picked.trim()) {
        const dir = picked.trim();
        setDirectories((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
        setDefaultDirectory((prev) => prev ?? dir);
      }
    } catch (err) {
      console.error(t("project.selectDirFailed"), err);
    }
  };

  const handleRemoveDirectory = (dir: string) => {
    setDirectories((prev) => {
      const next = prev.filter((d) => d !== dir);
      setDefaultDirectory((cur) => (cur === dir ? next[0] ?? null : cur));
      return next;
    });
  };

  const canSave = directories.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const created = await invoke<Project>("create_project", {
          name,
          description,
          directories,
          defaultDirectory,
        });
        onSaved(created);
      } else if (project) {
        const updated = await invoke<Project>("update_project", {
          project: { ...project, name, description, directories, defaultDirectory },
        });
        onSaved(updated);
      }
      onClose();
    } catch (err) {
      console.error(t("project.saveFailed"), err);
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog project-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{mode === "create" ? t("project.newProject") : t("project.projectSettings")}</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* 基本信息 */}
          <div className="form-item">
            <label>{mode === "create" ? t("project.projectNameCreatable") : t("project.projectName")}</label>
            <input
              type="text"
              className="zcode-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "create" ? t("project.projectPlaceholderPrefix") : t("project.projectNamePlaceholder")}
              autoFocus
            />
          </div>

          <div className="form-item">
            <label>{t("project.description")}</label>
            <input
              type="text"
              className="zcode-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("project.descriptionPlaceholder")}
            />
          </div>

          {/* 工作目录列表 */}
          <div className="form-item">
            <div className="directory-header">
              <label>{t("project.directories")}</label>
              <button type="button" className="zcode-btn-secondary small" onClick={handleAddDirectory}>
                {t("project.addDirectory")}
              </button>
            </div>
            {directories.length > 0 ? (
              <div className="directory-list">
                {directories.map((dir) => (
                  <div key={dir} className={`directory-row ${defaultDirectory === dir ? "default" : ""}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="directory-path" title={dir}>
                      {dir}
                    </span>
                    {defaultDirectory === dir ? (
                      <span className="directory-default-badge">{t("common.default")}</span>
                    ) : (
                      <button
                        type="button"
                        className="zcode-btn-secondary small"
                        onClick={() => setDefaultDirectory(dir)}
                      >
                        {t("common.setAsDefault")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: "20px", height: "20px", opacity: 0.6 }}
                      onClick={() => handleRemoveDirectory(dir)}
                      title={t("project.removeDir")}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="list-empty-item" style={{ marginTop: "6px" }}>
                {t("project.notChosen")}
              </div>
            )}
          </div>

          {/* 词元统计（编辑态） */}
          {mode === "edit" && (
            <div className="project-stats-section">
              <div className="models-list-header">
                <span>{t("project.stats")}</span>
              </div>
              <div className="stats-metric-grid compact">
                <div className="metric-card">
                  <span className="metric-label">{t("project.inputTokens")}</span>
                  <span className="metric-value">{stats ? stats.promptTokens.toLocaleString() : "0"}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{t("project.outputTokens")}</span>
                  <span className="metric-value">{stats ? stats.completionTokens.toLocaleString() : "0"}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{t("project.dispatchCount")}</span>
                  <span className="metric-value">{stats ? t("common.timesCount", { count: stats.requestCount }) : t("common.timesCount", { count: 0 })}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{t("project.avgLatency")}</span>
                  <span className="metric-value">
                    {stats && stats.requestCount > 0
                      ? `${Math.round(stats.totalLatencyMs / stats.requestCount)} ms`
                      : "0 ms"}
                  </span>
                </div>
              </div>
              {stats && stats.models.length > 0 && (
                <div className="models-table">
                  {stats.models.map((m) => (
                    <div key={m.modelName} className="model-row-item">
                      <span className="model-title">{m.modelName}</span>
                      <span>{m.promptTokens.toLocaleString()}</span>
                      <span>{m.completionTokens.toLocaleString()}</span>
                      <span>{t("common.timesCount", { count: m.requestCount })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="dialog-message" style={{ color: "var(--accent-danger)" }}>{error}</div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("project.cancel")}
          </button>
          <button type="button" className="btn-primary" disabled={!canSave} onClick={handleSave}>
            {saving ? t("project.saving") : mode === "create" ? t("project.createProject") : t("project.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
