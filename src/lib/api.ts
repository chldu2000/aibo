import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentDiagnostic,
  AgentEvent,
  ApprovalDecision,
  AppSnapshot,
  Session,
  TimelineItem,
  Workspace,
} from './types';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const listWorkspaces = (): Promise<Workspace[]> =>
  invoke<Workspace[]>('list_workspaces');

export const addWorkspace = (path: string): Promise<Workspace> =>
  invoke<Workspace>('add_workspace', { path });

export const setWorkspaceTrust = (
  workspaceId: string,
  trusted: boolean,
): Promise<Workspace> =>
  invoke<Workspace>('set_workspace_trust', { workspaceId, trusted });

export const removeWorkspace = (workspaceId: string): Promise<void> =>
  invoke('remove_workspace', { workspaceId });

export const probeAgents = (): Promise<AgentDiagnostic[]> =>
  invoke<AgentDiagnostic[]>('probe_agents');

export const getAppSnapshot = (): Promise<AppSnapshot> =>
  invoke<AppSnapshot>('get_app_snapshot');

export const listSessions = (workspaceId: string): Promise<Session[]> =>
  invoke<Session[]>('list_sessions', { workspaceId });

export const getTimeline = (sessionId: string): Promise<TimelineItem[]> =>
  invoke<TimelineItem[]>('get_timeline', { sessionId });

export const createCodexSession = (workspaceId: string): Promise<Session> =>
  invoke<Session>('create_codex_session', { workspaceId });

export const sendCodexPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('send_codex_prompt', { sessionId, input });

export const abortCodexTurn = (sessionId: string): Promise<void> =>
  invoke('abort_codex_turn', { sessionId });

export const resolveCodexApproval = (
  sessionId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<void> => invoke('resolve_codex_approval', { sessionId, requestId, decision });

export const closeCodexSession = (sessionId: string): Promise<void> =>
  invoke('close_codex_session', { sessionId });

export const listenToAgentEvents = (
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> => listen<AgentEvent>('agent-event', (event) => handler(event.payload));
