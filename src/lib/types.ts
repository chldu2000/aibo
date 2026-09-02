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
