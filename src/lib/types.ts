export type WorkspaceTrust = 'trusted' | 'untrusted';

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

export interface Session {
  id: string;
  workspaceId: string;
  agent: 'codex' | 'pi';
  label: string;
  state: SessionState;
  externalSessionId: string | null;
  createdAt: string;
  updatedAt: string;
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
  content: string;
  status: 'streaming' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
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
    | 'adapter.warning'
    | 'adapter.crashed';
  correlation: Record<string, string | number | null> | null;
  payload: Record<string, unknown>;
  rawRef: string | null;
}
