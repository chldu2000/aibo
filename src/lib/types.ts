export type WorkspaceTrust = 'trusted' | 'untrusted';

export type AgentName = 'codex' | 'pi';
export type InteractionMode = 'ask' | 'plan' | 'edit';
export type ApprovalPolicy = 'never' | 'on-request' | 'trusted';
export type FilesystemPolicy = 'read-only' | 'workspace-write';
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

export type AgentStatus = 'ready' | 'missing' | 'error';

export interface AgentDiagnostic {
  agent: 'codex' | 'pi';
  label: string;
  status: AgentStatus;
  executable: string | null;
  version: string | null;
  capabilities: string[];
  authState: 'delegated' | 'not_required' | 'unknown';
  message: string | null;
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
  agent: 'codex' | 'pi';
  label: string;
  state: SessionState;
  archived: boolean;
  externalSessionId: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface PiSessionSnapshotEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  role?: string;
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
  content: string;
  status: 'streaming' | 'completed' | 'failed';
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
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
  baselineExists: boolean;
  baselineHash: string | null;
  baselineSize: number | null;
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

export interface WorkspaceFileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface WorkspaceChanges {
  workspaceId: string;
  head: string | null;
  dirty: boolean;
  capturedAt: string;
  files: WorkspaceFileChange[];
  captureStatus: 'captured' | 'unsupported' | 'failed';
  captureError: string | null;
}

export interface TurnFileDiff {
  path: string;
  available: boolean;
  diff: string;
  reason: string | null;
}

export type GitFileAction = 'stage' | 'unstage' | 'revert';

export interface GitFileActionResult {
  path: string;
  action: GitFileAction;
  applied: boolean;
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

export interface AgentEvent {
  schemaVersion: '1.0';
  eventId: string;
  generationId: string;
  sequence: number;
  occurredAt: string;
  source: {
    agent: 'codex' | 'pi';
    transport: 'app-server' | 'pi-sdk' | 'pi-rpc' | 'replay';
    adapterVersion: string;
    agentVersion: string | null;
    protocolVersion: string | null;
  };
  workspaceId: string;
  sessionId: string;
  externalSessionId: string | null;
  turnId: string | null;
  type:
    | 'session.started'
    | 'session.state_changed'
    | 'turn.started'
    | 'turn.completed'
    | 'turn.failed'
    | 'message.delta'
    | 'message.completed'
    | 'tool.started'
    | 'tool.updated'
    | 'tool.completed'
    | 'approval.requested'
    | 'approval.resolved'
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
