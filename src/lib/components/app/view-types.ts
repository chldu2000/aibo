import type {
  ApprovalRequest,
  AgentDiagnostic,
  CodexThreadSummary,
  CodexThreadSnapshot,
  Session,
  SessionState,
  TimelineItem,
  WorkspaceTrust,
} from '$lib/types';

/**
 * Data exposed to the workspace sidebar. Keeping this smaller than the domain
 * models prevents the visual component from depending on adapter-only fields.
 */
export interface WorkspaceListItem {
  id: string;
  label: string;
  path: string;
  trust: WorkspaceTrust;
}

export interface SessionListItem {
  id: string;
  workspaceId: string;
  agent: 'codex' | 'pi';
  label: string;
  state: SessionState;
  archived: boolean;
  updatedAt: string;
}

export type SessionPanelView = Pick<
  Session,
  'id' | 'workspaceId' | 'agent' | 'label' | 'state' | 'archived' | 'externalSessionId' | 'updatedAt'
>;

export type TimelineViewItem = Pick<TimelineItem, 'id' | 'role' | 'toolName' | 'content' | 'status'>;

export type ApprovalView = Pick<
  ApprovalRequest,
  'requestId' | 'kind' | 'command' | 'cwd' | 'availableDecisions'
>;

export type CodexThreadView = Pick<CodexThreadSnapshot, 'id' | 'turnCount'>;

export type CodexThreadListItem = Pick<CodexThreadSummary, 'id' | 'title' | 'cwd' | 'status' | 'updatedAt'>;

export type AgentDiagnosticView = Pick<
  AgentDiagnostic,
  'agent' | 'label' | 'status' | 'executable' | 'version' | 'capabilities' | 'authState'
>;
