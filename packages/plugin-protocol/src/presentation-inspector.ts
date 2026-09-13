import type { PresentationConversation } from './presentation-conversation.js';
import type { PresentationGit } from './presentation-git.js';
type ProjectActionKind = 'test' | 'lint' | 'build' | 'custom';
interface CapabilityEntry {
  name: string;
  source: string;
}

interface WorkspaceCapabilityInventory {
  workspaceId: string;
  inspectedAt: string;
  instructions: CapabilityEntry[];
  skills: CapabilityEntry[];
  tools: CapabilityEntry[];
  mcpServers: CapabilityEntry[];
  warnings: string[];
}

interface ChangeSetState {
  head: string | null;
  dirty: boolean | null;
  capturedAt: string | null;
}

interface FileChange {
  path: string;
  previousPath: string | null;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  baselineExists: boolean;
  baselineHash: string | null;
  baselineSize: number | null;
  baselineDirty: boolean;
  resultExists: boolean;
  resultHash: string | null;
  resultSize: number | null;
}

interface CommandRunRef {
  id: string;
  toolName: string | null;
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  status: 'streaming' | 'completed' | 'failed' | string;
  output: string;
}

interface VerificationRef {
  id: string;
  status: 'running' | 'passed' | 'failed' | string;
  output: string;
}

interface TurnChangeSet {
  id: string;
  schema: 'aibo.turn-changeset/v1';
  workspaceId: string;
  sessionId: string;
  turnId: string;
  baseline: ChangeSetState;
  result: ChangeSetState;
  files: FileChange[];
  commands: CommandRunRef[];
  verification: VerificationRef[];
  attribution: 'agent' | 'mixed' | 'unknown';
  captureStatus: 'captured' | 'partial' | 'failed';
  captureError: string | null;
}

interface RestoreOperation {
  schema: 'aibo.restore-operation/v1';
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId: string;
  status: 'completed' | 'blocked' | 'failed';
  restored: string[];
  conflicts: string[];
  unsupported: string[];
  createdAt: string;
}

interface CheckpointFile {
  schema: 'aibo.checkpoint/v1';
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId: string;
  path: string;
  fileExists: boolean;
  contentHash: string | null;
  size: number | null;
  storagePath: string | null;
  baselineDirty: boolean;
  available: boolean;
  reason: string | null;
  createdAt: string;
}

interface Artifact {
  schema: 'aibo.artifact/v1';
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId: string | null;
  source: string;
  mediaType: string;
  size: number;
  contentHash: string;
  storagePath: string;
  createdAt: string;
}

interface ArtifactContent {
  artifact: Artifact;
  content: string;
  truncated: boolean;
}

interface ProjectAction {
  schema: 'aibo.project-action/v1';
  id: string;
  workspaceId: string;
  name: string;
  kind: ProjectActionKind;
  program: string;
  args: string[];
  cwd: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProjectActionRun {
  schema: 'aibo.project-action-run/v1' | 'aibo.project-action-run/v2' | 'aibo.project-action-run/v3';
  id: string;
  actionId: string;
  actionName?: string | null;
  workspaceId: string;
  sessionId: string | null;
  status: 'completed' | 'failed' | 'timed_out' | string;
  exitCode: number | null;
  output: string;
  artifactId: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface TurnDiffHunk {
  index: number;
  header: string;
  content: string;
}

interface TurnFileDiff {
  path: string;
  available: boolean;
  diff: string;
  hunks: TurnDiffHunk[];
  reason: string | null;
}

export type PresentationArtifactPreview = { sessionId: string | null; artifactId: string | null; content: ArtifactContent | null; loading: boolean; error: string | null };
export type PresentationInspector = {
  workspace: PresentationGit['workspace'];
  session: PresentationConversation['session'];
  desktop: boolean;
  open: boolean;
  activeView: 'context' | 'git';
  diagnostics: { agent: string; label: string; status: string; executable: string | null; version: string | null; capabilities: string[]; authState: string; message: string | null }[];
  workspaceCapabilities: WorkspaceCapabilityInventory | null;
  threads: { id: string; title: string | null; cwd: string | null; status: string | null; updatedAt: string | null }[];
  executionProfile: PresentationConversation['executionProfile'];
  attachments: PresentationConversation['attachments'];
  artifacts: Artifact[];
  artifactPreview: PresentationArtifactPreview;
  projectActions: ProjectAction[];
  projectActionRuns: ProjectActionRun[];
  changeSet: TurnChangeSet | null;
  checkpoints: CheckpointFile[];
  restoreOperations: RestoreOperation[];
  workspaceChanges: PresentationGit['changes'];
  fileDiff: TurnFileDiff | null;
  fileDiffLoading: boolean;
  fileDiffError: string | null;
  threadBusy: boolean;
  busy: boolean;
  running: boolean;
  archiving: boolean;
};
export type PresentationInspectorAction = {
  token: string;
  operation: 'selectView' | 'refresh' | 'syncThreads' | 'toggleArtifact' | 'closeArtifact'
    | 'showDiff' | 'restoreTurn' | 'fileAction' | 'hunkAction';
  event: 'click';
  args: readonly (string | null)[];
};
