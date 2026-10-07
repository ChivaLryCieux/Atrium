import React from "react";
import { useTranslation } from "react-i18next";
import { Project } from "../../types/chat";
import { useGitRepoState } from "./useGitRepoState";
import { GitRepoItem } from "./components/GitRepoItem";
import { GitCommitGraph } from "./components/GitCommitGraph";
import { GitDiffModal } from "./components/GitDiffModal";

export type GitSourceControlPanelProps = {
  projectId: string;
  project?: Project | null;
  workspacePath: string;
  width?: number;
  onClose: () => void;
};

export function GitSourceControlPanel({
  projectId,
  project,
  workspacePath,
  width,
  onClose,
}: GitSourceControlPanelProps) {
  const { t } = useTranslation();

  const {
    repos,
    selectedGraphRepoPath,
    setSelectedGraphRepoPath,
    commits,
    isLoadingCommits,
    commitMessages,
    setCommitMessages,
    diffModal,
    setDiffModal,
    selectedCommit,
    setSelectedCommit,
    isChangesExpanded,
    setIsChangesExpanded,
    isGraphExpanded,
    setIsGraphExpanded,
    isInitializing,
    selectedRepo,
    loadRepos,
    loadRepoStatus,
    loadCommits,
    handleStageFile,
    handleUnstageFile,
    handleStageAll,
    handleUnstageAll,
    handleDiscardFile,
    handleCommit,
    handlePush,
    handlePull,
    handleViewDiff,
    handleInitRepo,
  } = useGitRepoState({
    projectId,
    project,
    workspacePath,
  });

  return (
    <aside
      className="git-control-panel"
      style={width ? { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` } : undefined}
    >
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
                  {repos.map((repo) => (
                    <GitRepoItem
                      key={repo.info.path}
                      repo={repo}
                      isSelectedForGraph={repo.info.path === selectedGraphRepoPath}
                      commitMessage={commitMessages[repo.info.path] || ""}
                      onSelectRepoForGraph={() => setSelectedGraphRepoPath(repo.info.path)}
                      onCommitMessageChange={(msg) =>
                        setCommitMessages((prev) => ({ ...prev, [repo.info.path]: msg }))
                      }
                      onCommit={handleCommit}
                      onPush={handlePush}
                      onRefreshStatus={loadRepoStatus}
                      onStageFile={handleStageFile}
                      onUnstageFile={handleUnstageFile}
                      onStageAll={handleStageAll}
                      onUnstageAll={handleUnstageAll}
                      onDiscardFile={handleDiscardFile}
                      onViewDiff={handleViewDiff}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Lower Section: Visual Git Tree (Graph) ──────── */}
            <GitCommitGraph
              isGraphExpanded={isGraphExpanded}
              onToggleGraphExpanded={() => setIsGraphExpanded((prev) => !prev)}
              selectedRepo={selectedRepo}
              selectedGraphRepoPath={selectedGraphRepoPath}
              commits={commits}
              isLoadingCommits={isLoadingCommits}
              selectedCommit={selectedCommit}
              onSelectCommit={setSelectedCommit}
              onPull={handlePull}
              onPush={handlePush}
              onRefreshCommits={loadCommits}
            />
          </>
        )}
      </div>

      {/* ── Diff Modal ────────────────────────────────────────── */}
      {diffModal && (
        <GitDiffModal diffModal={diffModal} onClose={() => setDiffModal(null)} />
      )}
    </aside>
  );
}
