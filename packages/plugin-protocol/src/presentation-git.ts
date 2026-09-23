interface WorkspaceFileChange {
  path: string;
  previousPath: string | null;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

interface WorkspaceChanges {
  workspaceId: string;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  capturedAt: string;
  files: WorkspaceFileChange[];
  captureStatus: 'captured' | 'unsupported' | 'failed';
  captureError: string | null;
}

interface WorkspaceFileDiff {
  path: string;
  staged: boolean;
  available: boolean;
  truncated: boolean;
  diff: string;
  hunks: TurnDiffHunk[];
  reason: string | null;
}

interface TurnDiffHunk {
  index: number;
  header: string;
  content: string;
}

interface GitBranch {
  name: string;
  current: boolean;
  commit: string | null;
}

interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
}

interface GitCommitFile {
  path: string;
  previousPath: string | null;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface GitCommitFileList {
  commit: string;
  files: GitCommitFile[];
  total: number;
}

interface GitRemoteStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

interface GitStashEntry {
  reference: string;
  message: string;
}

export type PresentationGitDrafts = { commitMessage: string; branchDraft: string; gitSection: 'changes' | 'history'; selectedCommit: string | null };
export type GitRepository = { id: string; name: string; relativePath: string; kind: 'repository' | 'submodule' | 'worktree'; externalRoot: boolean };
export type GitRepositoryState = GitRepository & { changes: WorkspaceChanges | null; error: string | null };
export type GitRepositoryDiscovery = { repositories: GitRepository[]; limited: boolean; warnings: string[]; scanBudget: number };
export type PresentationGit = {
  repositories?: GitRepositoryState[];
  repositoryId?: string | null;
  repositorySearch?: string;
  repositoryPickerOpen?: boolean;
  collapsedRepositories?: string[];
  discoveryLimited?: boolean;
  discoveryWarnings?: string[];
  workspace: { id: string; label: string; path: string; trust: string } | null;
  sessionId: string | null;
  desktop: boolean;
  open: boolean;
  activeView: 'context' | 'git';
  changes: WorkspaceChanges | null;
  loading: boolean;
  error: string | null;
  branches: GitBranch[];
  history: GitCommit[];
  historyHasMore?: boolean;
  historyLoadingMore?: boolean;
  historyLoadMoreError?: string | null;
  metadataLoading: boolean;
  metadataError: string | null;
  commitFiles: GitCommitFileList | null;
  commitFilesLoading: boolean;
  remoteStatus: GitRemoteStatus | null;
  stashes: GitStashEntry[];
  operationBusy: boolean;
  reviewBusy: boolean;
  canRequestReview: boolean;
  draft: PresentationGitDrafts;
  preview: { fileDiff: WorkspaceFileDiff | null; loading: boolean; error: string | null; selectedPath: string | null; staged: boolean; contextLabel: string | null };
};
export type PresentationGitAction = {
  token: string;
  operation: 'togglePanel' | 'selectView' | 'selectSection' | 'refresh' | 'refreshMetadata'
    | 'commitMessage' | 'branchDraft' | 'commit' | 'createBranch' | 'checkoutBranch'
    | 'stageFile' | 'unstageFile' | 'stageAll' | 'unstageAll' | 'openDiff' | 'closeDiff'
    | 'selectCommit' | 'loadMoreHistory' | 'loadMoreCommitFiles' | 'openCommitDiff' | 'fetch' | 'pull' | 'push'
    | 'saveStash' | 'applyStash' | 'requestReview' | 'selectRepository' | 'repositorySearch' | 'toggleRepository' | 'continueDiscovery'
    | 'repositoryDiff' | 'repositoryStage' | 'repositoryUnstage' | 'repositoryStageAll' | 'repositoryUnstageAll';
  event: 'click' | 'input';
  args: readonly (string | null)[];
};
