import React from "react";
import { useTranslation } from "react-i18next";
import { GitCommit } from "../../../types/git";
import { RepoState } from "../types";

export type GitCommitGraphProps = {
  isGraphExpanded: boolean;
  onToggleGraphExpanded: () => void;
  selectedRepo?: RepoState;
  selectedGraphRepoPath: string;
  commits: GitCommit[];
  isLoadingCommits: boolean;
  selectedCommit: GitCommit | null;
  onSelectCommit: (commit: GitCommit | null) => void;
  onPull: (repoPath: string) => void;
  onPush: (repoPath: string) => void;
  onRefreshCommits: (repoPath: string) => void;
};

export const GitCommitGraph: React.FC<GitCommitGraphProps> = ({
  isGraphExpanded,
  onToggleGraphExpanded,
  selectedRepo,
  selectedGraphRepoPath,
  commits,
  isLoadingCommits,
  selectedCommit,
  onSelectCommit,
  onPull,
  onPush,
  onRefreshCommits,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="git-section git-graph-section">
        <div
          className="git-section-header"
          onClick={onToggleGraphExpanded}
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
              onClick={() => selectedGraphRepoPath && onPull(selectedGraphRepoPath)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              className="git-icon-action"
              title={t("git.push")}
              onClick={() => selectedGraphRepoPath && onPush(selectedGraphRepoPath)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              className="git-icon-action"
              title={t("git.refresh")}
              onClick={() => selectedGraphRepoPath && onRefreshCommits(selectedGraphRepoPath)}
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
                      onClick={() => onSelectCommit(isSelected ? null : commit)}
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

      {/* Commit Details Dialog */}
      {selectedCommit && (
        <div className="git-commit-dialog-backdrop" onClick={() => onSelectCommit(null)}>
          <div className="git-commit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="git-dialog-header">
              <span className="git-dialog-title truncate">{selectedCommit.summary}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => onSelectCommit(null)}
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
    </>
  );
};
