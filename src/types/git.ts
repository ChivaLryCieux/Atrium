export type GitRepoInfo = {
  id: string;
  name: string;
  path: string;
  isSubmodule: boolean;
  currentBranch: string;
  trackingBranch?: string | null;
  ahead: number;
  behind: number;
};

export type GitFileStatus = {
  path: string;
  staged: boolean;
  status: "M" | "A" | "D" | "?" | "R" | "U" | string;
  oldPath?: string | null;
};

export type GitRepoStatus = {
  repoInfo: GitRepoInfo;
  files: GitFileStatus[];
  isClean: boolean;
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  relativeDate: string;
  summary: string;
  refs: string[];
  isHead: boolean;
};
