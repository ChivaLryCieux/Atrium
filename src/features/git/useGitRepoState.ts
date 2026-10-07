import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GitCommit, GitRepoSnapshot, GitRepoStatus } from "../../types/git";
import { Project } from "../../types/chat";
import { DiffModalState, RepoState } from "./types";

export type UseGitRepoStateProps = {
  projectId: string;
  project?: Project | null;
  workspacePath: string;
};

export function useGitRepoState({
  projectId,
  project,
  workspacePath,
}: UseGitRepoStateProps) {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<RepoState[]>([]);
  const [selectedGraphRepoPath, setSelectedGraphRepoPath] = useState<string>("");
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState<boolean>(false);
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});
  const [diffModal, setDiffModal] = useState<DiffModalState | null>(null);
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
      const detected = await invoke<GitRepoSnapshot[]>("git_detect_repos_with_status", {
        projectPath: projectDirectory,
      });

      const initializedRepos: RepoState[] = detected.map((snapshot) => ({
        info: snapshot.info,
        status: snapshot.status,
        expanded: true,
        isCommitting: false,
        isPushing: false,
        isPulling: false,
        error: snapshot.error ?? null,
      }));

      setRepos(initializedRepos);

      if (detected.length > 0) {
        if (!selectedGraphRepoPath || !detected.some((r) => r.info.path === selectedGraphRepoPath)) {
          setSelectedGraphRepoPath(detected[0].info.path);
        }
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

  return {
    repos,
    setRepos,
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
    projectDirectory,
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
    handleFetch,
    handleViewDiff,
    handleInitRepo,
  };
}
