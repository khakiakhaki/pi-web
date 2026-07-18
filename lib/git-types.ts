export const MAX_DIFF_TEXT_BYTES = 521 * 1024;

export type GitChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "typeChanged";

export interface GitChangedFile {
  path: string;
  oldPath?: string;
  status: GitChangeStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface GitChangesResponse {
  isGit: boolean;
  repoRoot: string | null;
  branch: string | null;
  files: GitChangedFile[];
}

export interface GitFileDiffResponse {
  repoRoot: string;
  branch: string | null;
  path: string;
  oldPath?: string;
  status: GitChangeStatus;
  fullViewAvailable: boolean;
  maxTextBytes: number;
  oldSize: number;
  newSize: number;
  oldText?: string;
  newText?: string;
  patch?: string;
  limitedReason?: string;
}
