export type WorkspaceTrust = 'trusted' | 'untrusted';

export type AgentName = 'codex' | 'pi';
export type InteractionMode = 'ask' | 'plan' | 'edit';
export type SessionAccessMode = 'read-only' | 'plan' | 'workspace-write' | 'ask-for-approval' | 'approve-for-me' | 'full-access';
export type ApprovalPolicy = 'never' | 'untrusted' | 'on-request' | 'trusted';
export type FilesystemPolicy = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CommandPolicy = 'disabled' | 'approved' | 'trusted';
export type NetworkPolicy = 'disabled' | 'agent-managed';

export interface ExecutionProfile {
  schema: 'aibo.execution-profile/v1';
  interactionMode: InteractionMode;
  approvalPolicy: ApprovalPolicy;
  filesystemPolicy: FilesystemPolicy;
  commandPolicy: CommandPolicy;
  networkPolicy: NetworkPolicy;
  model?: string | null;
  reasoningEffort?: string | null;
}

export interface ResolvedExecutionProfile {
  schema: 'aibo.execution-profile/v1';
  requested: ExecutionProfile;
  enforced: ExecutionProfile;
  unsupported: string[];
  adapterCapabilities: string[];
  nativeSandbox: boolean;
  resolvedAt: string;
}

export interface SessionExecutionProfile extends ResolvedExecutionProfile {
  sessionId: string;
}

export interface Workspace {
  id: string;
  path: string;
  label: string;
  trust: WorkspaceTrust;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePathSuggestion {
  path: string;
  isDirectory: boolean;
}

export type AgentCommandCategory = 'agent' | 'skill' | 'extension';
export type AgentCommandExecution = 'aibo' | 'adapter' | 'prompt';

export interface AgentCommand {
  id?: string;
  name: string;
  aliases?: string[];
  description: string | null;
  source: 'extension' | 'prompt' | 'skill' | string;
  category?: AgentCommandCategory;
  execution?: AgentCommandExecution;
  agent?: AgentName | 'both';
  enabled?: boolean;
  argumentHint?: string;
  capability?: string;
}

export type AgentStatus = 'ready' | 'missing' | 'error';

export interface AgentDiagnostic {
  agent: string;
  label: string;
  status: AgentStatus;
  executable: string | null;
  version: string | null;
  capabilities: string[];
  authState: 'delegated' | 'not_required' | 'unknown';
  message: string | null;
}

export interface CapabilityEntry {
  name: string;
  source: string;
}

export interface WorkspaceCapabilityInventory {
  workspaceId: string;
  inspectedAt: string;
  instructions: CapabilityEntry[];
  skills: CapabilityEntry[];
  tools: CapabilityEntry[];
  mcpServers: CapabilityEntry[];
  warnings: string[];
}

export interface AppSnapshot {
  platform: string;
  appVersion: string;
  workspaceCount: number;
  diagnostics: AgentDiagnostic[];
}

export type SessionState =
  | 'created'
  | 'starting'
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'compacting'
  | 'interrupted'
  | 'failed'
  | 'closed';

export type SessionFilter = 'all' | 'active' | 'archived' | SessionState;

export interface SessionListOptions {
  search?: string;
  statusFilter?: SessionFilter;
}

export interface Session {
  id: string;
  workspaceId: string;
  agent: string;
  label: string;
  state: SessionState;
  archived: boolean;
  externalSessionId: string | null;
  pluginInstallationId: string | null;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionModelOption {
  reference: string;
  label: string;
  provider: string | null;
  id: string;
  description: string | null;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  reasoningEfforts: SessionReasoningOption[];
}

export interface SessionReasoningOption {
  id: string;
  label: string;
  description: string | null;
}

export interface SessionModelCatalog {
  current: SessionModelOption | null;
  models: SessionModelOption[];
  currentReasoningEffort: string | null;
  reasoningEfforts: SessionReasoningOption[];
}

export interface AgentGoal {
  objective: string;
  status: 'active' | 'paused' | 'completed' | 'cleared' | 'unknown';
  tokenBudget: number | null;
  tokensUsed: number | null;
  updatedAt: string | null;
}

export interface PiSessionTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  role?: string;
  summary?: string;
  label?: string;
  children: PiSessionTreeNode[];
}

export interface PiSessionTreeSnapshot {
  sessionId: string;
  externalSessionId: string | null;
  leafId: string | null;
  tree: PiSessionTreeNode[];
}

export interface PiSessionTreeNavigation extends PiSessionTreeSnapshot {
  cancelled: boolean;
  editorText: string | null;
}

export type PiTreeNavigationMode = 'none' | 'summary' | 'custom';

export interface PiTreeNavigationOptions {
  mode: PiTreeNavigationMode;
  customInstructions?: string;
}

export interface PiSessionSnapshotEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  role?: string;
  toolName?: string;
  stopReason?: string;
  isError?: boolean;
  customType?: string;
  summary?: string;
  data?: unknown;
}

export interface PiSessionSnapshot extends PiSessionTreeSnapshot {
  branch: PiSessionSnapshotEntry[];
}

export interface CodexThreadSummary {
  id: string;
  title: string | null;
  cwd: string | null;
  status: string | null;
  updatedAt: string | null;
}

export interface CodexThreadSnapshot extends CodexThreadSummary {
  turnCount: number;
}

export interface TimelineItem {
  id: string;
  sessionId: string;
  turnId: string | null;
  externalMessageId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  toolName: string | null;
  entryType: string | null;
  content: string;
  status: 'streaming' | 'completed' | 'failed' | 'queued' | 'interrupted';
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetState {
  head: string | null;
  dirty: boolean | null;
  capturedAt: string | null;
}

export interface FileChange {
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

export interface CommandRunRef {
  id: string;
  toolName: string | null;
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  status: 'streaming' | 'completed' | 'failed' | string;
  output: string;
}

export interface VerificationRef {
  id: string;
  status: 'running' | 'passed' | 'failed' | string;
  output: string;
}

export interface TurnChangeSet {
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

export interface RestoreTurnChangeSetResult {
  applied: boolean;
  restored: string[];
  conflicts: string[];
  unsupported: string[];
}

export interface RestoreOperation {
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

export interface CheckpointFile {
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

export interface WorkspaceFileChange {
  path: string;
  previousPath: string | null;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface WorkspaceChanges {
  workspaceId: string;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  capturedAt: string;
  files: WorkspaceFileChange[];
  captureStatus: 'captured' | 'unsupported' | 'failed';
  captureError: string | null;
}

export interface WorkspaceFileDiff {
  path: string;
  staged: boolean;
  available: boolean;
  truncated: boolean;
  diff: string;
  hunks: TurnDiffHunk[];
  reason: string | null;
}

export interface TurnFileDiff {
  path: string;
  available: boolean;
  diff: string;
  hunks: TurnDiffHunk[];
  reason: string | null;
}

export interface TurnDiffHunk {
  index: number;
  header: string;
  content: string;
}

export interface ContextAttachment {
  schema: 'aibo.context-attachment/v1';
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId: string | null;
  path: string;
  contentHash: string | null;
  size: number | null;
  mediaType: string;
  source: 'picker' | 'drop' | 'manual' | string;
  sendStrategy: 'reference' | 'inline' | string;
  createdAt: string;
}

export interface ContextAttachmentValidation {
  id: string;
  path: string;
  status: 'ready' | 'missing' | 'changed' | string;
  reason: string | null;
  currentHash: string | null;
  size: number | null;
}

export interface Artifact {
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

export interface ArtifactContent {
  artifact: Artifact;
  content: string;
  truncated: boolean;
}

export type ProjectActionKind = 'test' | 'lint' | 'build' | 'custom';

export interface ProjectAction {
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

export interface WorkspaceWriteRun {
  cancelRequestedAt?: string | null;
  schema: 'aibo.workspace-write-run/v1';
  id: string;
  requestId?: string | null;
  callerWindow?: string | null;
  workspaceId: string;
  operation: string;
  status: 'running' | 'completed' | 'failed' | 'outcome_unknown';
  snapshot: { schema: 'aibo.workspace-write-intent/v1'; origin: 'host'; workspaceId: string; workspacePath: string; operation: string; input: Record<string, unknown> };
  result: { ok: true; output: unknown } | { ok: false; error: { code: string; message: string } } | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ProjectActionRun {
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

export type GitFileAction = 'stage' | 'unstage' | 'revert';

export interface GitHunkActionResult {
  path: string;
  hunkIndex: number;
  action: GitFileAction;
  applied: boolean;
  message: string;
}

export interface GitFileActionResult {
  path: string;
  action: GitFileAction;
  applied: boolean;
  message: string;
}

export type GitWorkspaceAction = 'stage_all' | 'unstage_all';
export type GitWorkspaceResultAction =
  | GitWorkspaceAction
  | GitSyncAction
  | 'checkout'
  | 'create_branch'
  | 'stash_apply'
  | 'stash_push';

export interface GitWorkspaceActionResult {
  action: GitWorkspaceResultAction;
  applied: boolean;
  message: string;
}

export interface GitCommitResult {
  committed: boolean;
  hash: string | null;
  message: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  commit: string | null;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
}

export interface GitCommitFile {
  path: string;
  previousPath: string | null;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface GitCommitFileList {
  commit: string;
  files: GitCommitFile[];
  total: number;
}

export type GitSyncAction = 'fetch' | 'pull' | 'push';

export interface GitRemoteStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitStashEntry {
  reference: string;
  message: string;
}

export type ApprovalDecision = 'accept' | 'cancel';

export interface ApprovalRequest {
  requestId: string;
  sessionId: string;
  turnId: string | null;
  kind: string;
  command: string | null;
  cwd: string | null;
  availableDecisions: ApprovalDecision[];
}

export interface UserInputOption {
  label: string;
  description: string | null;
}

export interface UserInputQuestion {
  id: string;
  header: string | null;
  question: string;
  options: UserInputOption[];
  isOther: boolean;
}

export interface UserInputRequest {
  requestId: string;
  sessionId: string;
  turnId: string | null;
  questions: UserInputQuestion[];
  isBlocking: boolean;
}

/** Adapter-neutral view of work queued while an Agent is busy. */
export interface AgentQueueSnapshot {
  sessionId: string;
  steering: string[];
  followUp: string[];
  updatedAt: string;
}

/** A normalized context budget projection. Values may be estimated when the provider
 * only reports cumulative input usage rather than an exact live context size. */
export interface ContextUsage {
  used: number | null;
  limit: number | null;
  estimated: boolean;
}

export interface ComposerDraft {
  schemaVersion?: string;
  sessionId?: string;
  text: string;
  updatedAt: string;
  sendFailed?: boolean;
}

export interface AgentEvent {
  schemaVersion: '1.0' | '2.0';
  eventId: string;
  generationId: string;
  sequence: number;
  occurredAt: string;
  source: {
    agent?: string;
    transport?: 'app-server' | 'pi-sdk' | 'pi-rpc' | 'replay';
    adapterVersion?: string;
    agentVersion?: string | null;
    protocolVersion?: string | null;
    pluginId?: string;
    pluginVersion?: string;
    agentId?: string;
    runtimeProtocolVersion?: string;
  };
  workspaceId: string;
  sessionId: string;
  externalSessionId?: string | null;
  nativeSessionId?: string | null;
  turnId: string | null;
  type:
    | 'session.started'
    | 'session.state_changed'
    | 'turn.started'
    | 'turn.completed'
    | 'turn.failed'
    | 'message.delta'
    | 'message.completed'
    | 'reasoning.updated'
    | 'reasoning.completed'
    | 'tool.started'
    | 'tool.updated'
    | 'tool.completed'
    | 'approval.requested'
    | 'approval.resolved'
    | 'user_input.requested'
    | 'user_input.resolved'
    | 'usage.updated'
    | 'queue.updated'
    | 'compaction.started'
    | 'compaction.completed'
    | 'retry.started'
    | 'retry.completed'
    | 'extension.updated'
    | 'session.info_changed'
    | 'adapter.warning'
    | 'adapter.crashed';
  correlation: Record<string, string | number | null> | null;
  payload: Record<string, unknown>;
  rawRef: string | null;
}
