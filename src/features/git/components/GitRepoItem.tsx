import React from "react";
import { useTranslation } from "react-i18next";
import { RepoState } from "../types";

export type GitRepoItemProps = {
  repo: RepoState;
  isSelectedForGraph: boolean;
  commitMessage: string;
  onSelectRepoForGraph: () => void;
  onCommitMessageChange: (msg: string) => void;
  onCommit: (repoPath: string, andPush?: boolean) => void;
  onPush: (repoPath: string) => void;
  onRefreshStatus: (repoPath: string) => void;
  onStageFile: (repoPath: string, filePath: string) => void;
  onUnstageFile: (repoPath: string, filePath: string) => void;
  onStageAll: (repoPath: string) => void;
  onUnstageAll: (repoPath: string) => void;
  onDiscardFile: (repoPath: string, filePath: string) => void;
  onViewDiff: (repoPath: string, filePath: string, staged: boolean) => void;
};

export const GitRepoItem: React.FC<GitRepoItemProps> = ({
  repo,
  isSelectedForGraph,
  commitMessage,
  onSelectRepoForGraph,
  onCommitMessageChange,
  onCommit,
  onPush,
  onRefreshStatus,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onDiscardFile,
  onViewDiff,
}) => {
  const { t } = useTranslation();
  const stagedFiles = repo.status?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = repo.status?.files.filter((f) => !f.staged) ?? [];

  return (
    <div className="git-repo-card">
      {/* Repo Title Row */}
      <div
        className={`git-repo-row ${isSelectedForGraph ? "active" : ""}`}
        onClick={onSelectRepoForGraph}
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
            onClick={() => onPush(repo.info.path)}
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
            onClick={() => onRefreshStatus(repo.info.path)}
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
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              onCommit(repo.info.path);
            }
          }}
        />

        <div className="git-commit-btn-row">
          <button
            type="button"
            className="git-btn-primary"
            disabled={repo.isCommitting || !commitMessage.trim()}
            onClick={() => onCommit(repo.info.path)}
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
            disabled={repo.isCommitting || !commitMessage.trim()}
            onClick={() => onCommit(repo.info.path, true)}
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
                onClick={() => onUnstageAll(repo.info.path)}
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
                onClick={() => onViewDiff(repo.info.path, file.path, true)}
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
                    onClick={() => onUnstageFile(repo.info.path, file.path)}
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

      {/* Changes (Unstaged) Section */}
      {unstagedFiles.length > 0 && (
        <div className="git-file-group">
          <div className="git-group-header">
            <span>{t("git.unstagedChanges")}</span>
            <div className="git-group-header-right">
              <span className="git-badge-sm">{unstagedFiles.length}</span>
              <button
                type="button"
                className="git-icon-btn-xs"
                title={t("git.stageAll")}
                onClick={() => onStageAll(repo.info.path)}
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
                onClick={() => onViewDiff(repo.info.path, file.path, false)}
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
                    onClick={() => onDiscardFile(repo.info.path, file.path)}
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
                    onClick={() => onStageFile(repo.info.path, file.path)}
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
};
