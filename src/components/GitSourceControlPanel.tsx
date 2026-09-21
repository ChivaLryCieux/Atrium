import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GitCommit, GitFileStatus, GitRepoInfo, GitRepoStatus } from "../types/git";
import { Project } from "../types/chat";

type GitSourceControlPanelProps = {
  projectId: string;
  project?: Project | null;
  workspacePath: string;
  onClose: () => void;
};

type RepoState = {
  info: GitRepoInfo;
  status: GitRepoStatus | null;
  expanded: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  error?: string | null;
};

export function GitSourceControlPanel({
  projectId,
  project,
  workspacePath,
  onClose,
}: GitSourceControlPanelProps) {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<RepoState[]>([]);
  const [selectedGraphRepoPath, setSelectedGraphRepoPath] = useState<string>("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState<boolean>(false);
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});
  const [diffModal, setDiffModal] = useState<{
    filePath: string;
    repoPath: string;
    diff: string;
    staged: boolean;
  } | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [isChangesExpanded, setIsChangesExpanded] = useState<boolean>(true);
  const [isGraphExpanded, setIsGraphExpanded] = useState<boolean>(true);
  const [isInitializing, setIsInitializing] = useState<boolean>(false);

  // Compute target project directory
  const projectDirectory = useMemo(() => {
    return (
      project?.defaultDirectory ||
      (project?.directories && project.directories[0]) ||
      workspacePath
    );
  }, [project, workspacePath]);

  // Load repositories in current project directory
  const loadRepos = async () => {
    if (!projectDirectory) return;
    try {
      const detected = await invoke<GitRepoInfo[]>("git_detect_repos", {
        projectPath: projectDirectory,
      });

      const initializedRepos: RepoState[] = detected.map((info) => ({
        info,
        status: null,
        expanded: true,
        isCommitting: false,
        isPushing: false,
        isPulling: false,
        error: null,
      }));

      setRepos(initializedRepos);

      if (detected.length > 0) {
        if (!selectedGraphRepoPath || !detected.some((r) => r.path === selectedGraphRepoPath)) {
          setSelectedGraphRepoPath(detected[0].path);
        }
      }

      // Fetch statuses for each repo
      for (const repo of detected) {
        loadRepoStatus(repo.path);
      }
    } catch (err) {
      console.error("Failed to detect git repos:", err);
    }
  };

  const loadRepoStatus = async (repoPath: string) => {
    try {
      const status = await invoke<GitRepoStatus>("git_get_status", { repoPath });
      setRepos((prev) =>
        prev.map((r) => (r.info.path === repoPath ? { ...r, status, error: null } : r))
      );
    } catch (err) {
      console.error(`Failed to get status for ${repoPath}:`, err);
      setRepos((prev) =>
        prev.map((r) =>
          r.info.path === repoPath ? { ...r, error: String(err) } : r
        )
      );
    }
  };

  const loadCommits = async (repoPath: string) => {
    if (!repoPath) return;
    setIsLoadingCommits(true);
    try {
      const list = await invoke<GitCommit[]>("git_get_log", {
        repoPath,
        maxCount: 40,
      });
      setCommits(list);
    } catch (err) {
      console.error(`Failed to get commit log for ${repoPath}:`, err);
      setCommits([]);
    } finally {
      setIsLoadingCommits(false);
    }
  };

  useEffect(() => {
    loadRepos();
  }, [projectId, projectDirectory]);

  useEffect(() => {
    if (selectedGraphRepoPath) {
      loadCommits(selectedGraphRepoPath);
    }
  }, [selectedGraphRepoPath]);

  // Stage single file
  const handleStageFile = async (repoPath: string, filePath: string) => {
    try {
      await invoke("git_stage_file", { repoPath, filePath });
      loadRepoStatus(repoPath);
    } catch (err) {
      console.error("Stage failed:", err);
    }
  };

  // Unstage single file
  const handleUnstageFile = async (repoPath: string, filePath: string) => {
    try {
      await invoke("git_unstage_file", { repoPath, filePath });
      loadRepoStatus(repoPath);
    } catch (err) {
      console.error("Unstage failed:", err);
    }
  };

  // Stage all
  const handleStageAll = async (repoPath: string) => {
    try {
      await invoke("git_stage_all", { repoPath });
      loadRepoStatus(repoPath);
    } catch (err) {
      console.error("Stage all failed:", err);
    }
  };

  // Unstage all
  const handleUnstageAll = async (repoPath: string) => {
    try {
      await invoke("git_unstage_all", { repoPath });
      loadRepoStatus(repoPath);
    } catch (err) {
      console.error("Unstage all failed:", err);
    }
  };

  // Discard file changes
  const handleDiscardFile = async (repoPath: string, filePath: string) => {
    if (!window.confirm(t("git.confirmDiscard", { file: filePath }))) return;
    try {
      await invoke("git_discard_file", { repoPath, filePath });
      loadRepoStatus(repoPath);
    } catch (err) {
      console.error("Discard failed:", err);
    }
  };

  // Commit
  const handleCommit = async (repoPath: string, andPush = false) => {
    const msg = (commitMessages[repoPath] || "").trim();
    if (!msg) return;

    setRepos((prev) =>
      prev.map((r) => (r.info.path === repoPath ? { ...r, isCommitting: true } : r))
    );

    try {
      // Auto-stage all if no staged files exist
      const repo = repos.find((r) => r.info.path === repoPath);
      const hasStaged = repo?.status?.files.some((f) => f.staged) ?? false;
      if (!hasStaged) {
        await invoke("git_stage_all", { repoPath });
      }

      await invoke("git_commit", { repoPath, message: msg });
      setCommitMessages((prev) => ({ ...prev, [repoPath]: "" }));

      if (andPush) {
        await invoke("git_push", { repoPath });
      }

      await loadRepoStatus(repoPath);
      if (selectedGraphRepoPath === repoPath) {
        await loadCommits(repoPath);
      }
    } catch (err) {
      alert(`Commit error: ${err}`);
    } finally {
      setRepos((prev) =>
        prev.map((r) => (r.info.path === repoPath ? { ...r, isCommitting: false } : r))
      );
    }
  };

  // Push
  const handlePush = async (repoPath: string) => {
    setRepos((prev) =>
      prev.map((r) => (r.info.path === repoPath ? { ...r, isPushing: true } : r))
    );
    try {
      await invoke("git_push", { repoPath });
      loadRepoStatus(repoPath);
      if (selectedGraphRepoPath === repoPath) {
        loadCommits(repoPath);
      }
    } catch (err) {
      alert(`Push error: ${err}`);
    } finally {
      setRepos((prev) =>
        prev.map((r) => (r.info.path === repoPath ? { ...r, isPushing: false } : r))
      );
    }
  };

  // Pull
  const handlePull = async (repoPath: string) => {
    setRepos((prev) =>
      prev.map((r) => (r.info.path === repoPath ? { ...r, isPulling: true } : r))
    );
    try {
      await invoke("git_pull", { repoPath });
      loadRepoStatus(repoPath);
      if (selectedGraphRepoPath === repoPath) {
        loadCommits(repoPath);
      }
    } catch (err) {
      alert(`Pull error: ${err}`);
    } finally {
      setRepos((prev) =>
        prev.map((r) => (r.info.path === repoPath ? { ...r, isPulling: false } : r))
      );
    }
  };

  // Fetch
  const handleFetch = async (repoPath: string) => {
    try {
      await invoke("git_fetch", { repoPath });
      loadRepoStatus(repoPath);
      if (selectedGraphRepoPath === repoPath) {
        loadCommits(repoPath);
      }
    } catch (err) {
      alert(`Fetch error: ${err}`);
    }
  };

  // View Diff
  const handleViewDiff = async (repoPath: string, filePath: string, staged: boolean) => {
    try {
      const diff = await invoke<string>("git_get_diff", {
        repoPath,
        filePath,
        staged,
      });
      setDiffModal({ filePath, repoPath, diff: diff || t("git.emptyDiff"), staged });
    } catch (err) {
      alert(`Diff error: ${err}`);
    }
  };

  // Initialize Git Repository
  const handleInitRepo = async () => {
    if (!projectDirectory) return;
    setIsInitializing(true);
    try {
      await invoke("git_init", { repoPath: projectDirectory });
      await loadRepos();
    } catch (err) {
      alert(`初始化 Git 仓库失败: ${err}`);
    } finally {
      setIsInitializing(false);
    }
  };

  const selectedRepo = repos.find((r) => r.info.path === selectedGraphRepoPath);

  return (
    <aside className="git-control-panel">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="git-panel-header">
        <div className="git-panel-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M18 6v6a2 2 0 0 1-2 2H8" />
            <path d="M6 9v12" />
          </svg>
          <span>{t("git.title")}</span>
        </div>
        <div className="git-panel-actions">
          <button
            type="button"
            className="icon-btn"
            title={t("git.refresh")}
            onClick={() => {
              loadRepos();
              if (selectedGraphRepoPath) loadCommits(selectedGraphRepoPath);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("git.close")}
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Scrollable Body: Split into Upper (Changes) & Lower (Graph) ── */}
      <div className="git-panel-scroll">
        {repos.length === 0 ? (
          <div className="git-empty-state">
            <div className="git-empty-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M18 6v6a2 2 0 0 1-2 2H8" />
                <path d="M6 9v12" />
              </svg>
            </div>
            <div className="git-empty-title">{t("git.noRepos")}</div>
            <p className="git-empty-desc">{t("git.initDesc")}</p>
            <button
              type="button"
              className="git-btn-init"
              disabled={isInitializing}
              onClick={handleInitRepo}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{isInitializing ? t("git.initializing") : t("git.initRepo")}</span>
            </button>
          </div>
        ) : (
          <>
            {/* ── Upper Section: Changes ──────────────────────── */}
            <div className="git-section git-changes-section">
              <div
                className="git-section-header"
                onClick={() => setIsChangesExpanded((prev) => !prev)}
              >
                <span className={`git-chevron ${isChangesExpanded ? "expanded" : ""}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
                <span className="git-section-title">{t("git.changes")}</span>
                <span className="git-badge-counter">
                  {repos.reduce((acc, r) => acc + (r.status?.files.length ?? 0), 0)}
                </span>
              </div>

              {isChangesExpanded && (
                <div className="git-repos-list">
                  {repos.map((repo) => {
                    const stagedFiles = repo.status?.files.filter((f) => f.staged) ?? [];
                    const unstagedFiles = repo.status?.files.filter((f) => !f.staged) ?? [];
                    const msg = commitMessages[repo.info.path] || "";
                    const isSelectedForGraph = repo.info.path === selectedGraphRepoPath;

                    return (
                      <div key={repo.info.path} className="git-repo-card">
                        {/* Repo Title Row */}
                        <div
                          className={`git-repo-row ${isSelectedForGraph ? "active" : ""}`}
                          onClick={() => setSelectedGraphRepoPath(repo.info.path)}
                        >
                          <div className="git-repo-left">
                            <span className="git-repo-icon">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                            </span>
                            <span className="git-repo-name truncate" title={repo.info.path}>
                              {repo.info.name}
                            </span>
                            <span className="git-branch-pill" title={repo.info.currentBranch}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="18" cy="18" r="3" />
                                <circle cx="6" cy="6" r="3" />
                                <path d="M18 6v6a2 2 0 0 1-2 2H8" />
                                <path d="M6 9v12" />
                              </svg>
                              <span className="truncate">{repo.info.currentBranch}</span>
                            </span>
                          </div>

                          <div className="git-repo-actions" onClick={(e) => e.stopPropagation()}>
                            {/* Sync Status / Pull & Push */}
                            <button
                              type="button"
                              className="git-icon-action"
                              title={`${t("git.sync")} (↓${repo.info.behind} ↑${repo.info.ahead})`}
                              disabled={repo.isPushing || repo.isPulling}
                              onClick={() => handlePush(repo.info.path)}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              {(repo.info.ahead > 0 || repo.info.behind > 0) && (
                                <span className="git-sync-num">{repo.info.ahead}</span>
                              )}
                            </button>
                            {/* Refresh */}
                            <button
                              type="button"
                              className="git-icon-action"
                              title={t("git.refresh")}
                              onClick={() => loadRepoStatus(repo.info.path)}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Commit Input Box */}
                        <div className="git-commit-box">
                          <textarea
                            className="git-commit-input"
                            rows={2}
                            placeholder={t("git.commitPlaceholder", {
                              branch: repo.info.currentBranch,
                            })}
                            value={msg}
                            onChange={(e) =>
                              setCommitMessages((prev) => ({
                                ...prev,
                                [repo.info.path]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                e.preventDefault();
                                handleCommit(repo.info.path);
                              }
                            }}
                          />

                          <div className="git-commit-btn-row">
                            <button
                              type="button"
                              className="git-btn-primary"
                              disabled={repo.isCommitting || !msg.trim()}
                              onClick={() => handleCommit(repo.info.path)}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>
                                {repo.isCommitting ? "..." : t("git.commit")}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="git-btn-secondary"
                              title={t("git.commitAndPush")}
                              disabled={repo.isCommitting || !msg.trim()}
                              onClick={() => handleCommit(repo.info.path, true)}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Staged Changes Section */}
                        {stagedFiles.length > 0 && (
                          <div className="git-file-group">
                            <div className="git-group-header">
                              <span>{t("git.stagedChanges")}</span>
                              <div className="git-group-header-right">
                                <span className="git-badge-sm">{stagedFiles.length}</span>
                                <button
                                  type="button"
                                  className="git-icon-btn-xs"
                                  title={t("git.unstageAll")}
                                  onClick={() => handleUnstageAll(repo.info.path)}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div className="git-file-list">
                              {stagedFiles.map((file) => (
                                <div
                                  key={file.path}
                                  className="git-file-row"
                                  onClick={() => handleViewDiff(repo.info.path, file.path, true)}
                                >
                                  <span className={`git-status-badge ${file.status}`}>
                                    {file.status}
                                  </span>
                                  <span className="git-file-name truncate" title={file.path}>
                                    {file.path.split("/").pop()}
                                    <span className="git-file-dir">
                                      {file.path.includes("/")
                                        ? ` ${file.path.substring(0, file.path.lastIndexOf("/"))}`
                                        : ""}
                                    </span>
                                  </span>
                                  <div className="git-file-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="git-icon-btn-xs"
                                      title={t("git.unstage")}
                                      onClick={() => handleUnstageFile(repo.info.path, file.path)}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Unstaged Changes Section */}
                        {unstagedFiles.length > 0 && (
                          <div className="git-file-group">
                            <div className="git-group-header">
                              <span>{t("git.changes")}</span>
                              <div className="git-group-header-right">
                                <span className="git-badge-sm">{unstagedFiles.length}</span>
                                <button
                                  type="button"
                                  className="git-icon-btn-xs"
                                  title={t("git.stageAll")}
                                  onClick={() => handleStageAll(repo.info.path)}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div className="git-file-list">
                              {unstagedFiles.map((file) => (
                                <div
                                  key={file.path}
                                  className="git-file-row"
                                  onClick={() => handleViewDiff(repo.info.path, file.path, false)}
                                >
                                  <span className={`git-status-badge ${file.status}`}>
                                    {file.status}
                                  </span>
                                  <span className="git-file-name truncate" title={file.path}>
                                    {file.path.split("/").pop()}
                                    <span className="git-file-dir">
                                      {file.path.includes("/")
                                        ? ` ${file.path.substring(0, file.path.lastIndexOf("/"))}`
                                        : ""}
                                    </span>
                                  </span>
                                  <div className="git-file-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="git-icon-btn-xs"
                                      title={t("git.discard")}
                                      onClick={() => handleDiscardFile(repo.info.path, file.path)}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                        <path d="M3 3v5h5" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="git-icon-btn-xs"
                                      title={t("git.stage")}
                                      onClick={() => handleStageFile(repo.info.path, file.path)}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="12" y1="5" x2="12" y2="19" />
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
                          <div className="git-clean-indicator">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{t("git.noChanges")}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Lower Section: Visual Git Tree (Graph) ──────── */}
            <div className="git-section git-graph-section">
              <div
                className="git-section-header"
                onClick={() => setIsGraphExpanded((prev) => !prev)}
              >
                <span className={`git-chevron ${isGraphExpanded ? "expanded" : ""}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
                <span className="git-section-title">
                  {t("git.gitGraph")}
                  {selectedRepo ? ` (${selectedRepo.info.name})` : ""}
                </span>

                <div className="git-graph-header-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="git-icon-action"
                    title={t("git.pull")}
                    onClick={() => selectedGraphRepoPath && handlePull(selectedGraphRepoPath)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="git-icon-action"
                    title={t("git.push")}
                    onClick={() => selectedGraphRepoPath && handlePush(selectedGraphRepoPath)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="git-icon-action"
                    title={t("git.refresh")}
                    onClick={() => selectedGraphRepoPath && loadCommits(selectedGraphRepoPath)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                  </button>
                </div>
              </div>

              {isGraphExpanded && (
                <div className="git-graph-content">
                  {isLoadingCommits ? (
                    <div className="git-graph-loading">...</div>
                  ) : commits.length === 0 ? (
                    <div className="git-graph-empty">{t("git.noChanges")}</div>
                  ) : (
                    <div className="git-tree-list">
                      {commits.map((commit, index) => {
                        const isSelected = selectedCommit?.hash === commit.hash;
                        const isLast = index === commits.length - 1;

                        return (
                          <div
                            key={commit.hash}
                            className={`git-tree-node ${isSelected ? "selected" : ""}`}
                            onClick={() => setSelectedCommit(isSelected ? null : commit)}
                          >
                            {/* SVG Rail Column */}
                            <div className="git-tree-rail">
                              <svg width="18" height="100%" viewBox="0 0 18 36" preserveAspectRatio="none">
                                {/* Vertical connector line */}
                                {!isLast && (
                                  <line
                                    x1="9"
                                    y1="12"
                                    x2="9"
                                    y2="36"
                                    stroke="var(--border-strong)"
                                    strokeWidth="2"
                                  />
                                )}
                                {index > 0 && (
                                  <line
                                    x1="9"
                                    y1="0"
                                    x2="9"
                                    y2="12"
                                    stroke="var(--border-strong)"
                                    strokeWidth="2"
                                  />
                                )}
                                {/* Commit Marker Dot */}
                                {commit.isHead ? (
                                  <circle
                                    cx="9"
                                    cy="12"
                                    r="4.5"
                                    fill="var(--bg-app)"
                                    stroke="var(--accent-blue)"
                                    strokeWidth="2.5"
                                  />
                                ) : (
                                  <circle
                                    cx="9"
                                    cy="12"
                                    r="4"
                                    fill="var(--accent-blue)"
                                  />
                                )}
                              </svg>
                            </div>

                            {/* Commit Body Info */}
                            <div className="git-tree-info">
                              <div className="git-tree-summary-row">
                                <span className={`git-tree-summary truncate ${commit.isHead ? "bold" : ""}`} title={commit.summary}>
                                  {commit.summary}
                                </span>
                                {commit.refs.map((r) => {
                                  const isRemote = r.includes("origin/") || r.includes("/");
                                  const isTag = r.startsWith("tag: ");
                                  const cleanRef = r.replace(/^HEAD -> /, "").replace(/^tag: /, "");
                                  return (
                                    <span
                                      key={r}
                                      className={`git-ref-pill ${isRemote ? "remote" : isTag ? "tag" : "branch"}`}
                                      title={r}
                                    >
                                      {cleanRef}
                                    </span>
                                  );
                                })}
                              </div>

                              <div className="git-tree-meta-row">
                                <span className="git-tree-author truncate">{commit.authorName}</span>
                                <span className="git-tree-date">{commit.relativeDate}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Commit Details Dialog ──────────────────────────────── */}
      {selectedCommit && (
        <div className="git-commit-dialog-backdrop" onClick={() => setSelectedCommit(null)}>
          <div className="git-commit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="git-dialog-header">
              <span className="git-dialog-title truncate">{selectedCommit.summary}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedCommit(null)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="git-dialog-body">
              <div className="git-meta-item">
                <span className="git-meta-label">Commit:</span>
                <span className="git-meta-value code">{selectedCommit.hash}</span>
              </div>
              <div className="git-meta-item">
                <span className="git-meta-label">Author:</span>
                <span className="git-meta-value">
                  {selectedCommit.authorName} &lt;{selectedCommit.authorEmail}&gt;
                </span>
              </div>
              <div className="git-meta-item">
                <span className="git-meta-label">Date:</span>
                <span className="git-meta-value">{selectedCommit.relativeDate}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Diff Modal ────────────────────────────────────────── */}
      {diffModal && (
        <div className="git-diff-modal-backdrop" onClick={() => setDiffModal(null)}>
          <div className="git-diff-modal" onClick={(e) => e.stopPropagation()}>
            <div className="git-diff-header">
              <div className="git-diff-title truncate">
                <span className="git-diff-type">{diffModal.staged ? "STAGED" : "CHANGES"}</span>
                <span>{diffModal.filePath}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDiffModal(null)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <pre className="git-diff-content">
              {diffModal.diff.split("\n").map((line, idx) => {
                const isAdd = line.startsWith("+") && !line.startsWith("+++");
                const isDel = line.startsWith("-") && !line.startsWith("---");
                const isHunk = line.startsWith("@@");
                return (
                  <div
                    key={idx}
                    className={`git-diff-line ${isAdd ? "add" : isDel ? "del" : isHunk ? "hunk" : ""}`}
                  >
                    {line}
                  </div>
                );
              })}
            </pre>
          </div>
        </div>
      )}
    </aside>
  );
}
