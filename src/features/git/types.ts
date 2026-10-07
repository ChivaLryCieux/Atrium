import { GitCommit, GitRepoInfo, GitRepoStatus } from "../../types/git";

export type RepoState = {
  info: GitRepoInfo;
  status: GitRepoStatus | null;
  expanded: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  error?: string | null;
};

export type DiffModalState = {
  filePath: string;
  repoPath: string;
  diff: string;
  staged: boolean;
};
