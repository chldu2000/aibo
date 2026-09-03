import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentDiagnostic,
  AgentEvent,
  ApprovalDecision,
  AppSnapshot,
  CodexThreadSnapshot,
  CodexThreadSummary,
  PiSessionTreeNavigation,
  PiSessionSnapshot,
  PiSessionTreeSnapshot,
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

export const listCodexThreads = (workspaceId: string): Promise<CodexThreadSummary[]> =>
  invoke<CodexThreadSummary[]>('list_codex_threads', { workspaceId });

export const readCodexThread = (sessionId: string): Promise<CodexThreadSnapshot> =>
  invoke<CodexThreadSnapshot>('read_codex_thread', { sessionId });

export const forkCodexThread = (
  sessionId: string,
  throughTurnId?: string | null,
): Promise<Session> =>
  invoke<Session>('fork_codex_thread', { sessionId, throughTurnId: throughTurnId ?? null });

export const archiveCodexThread = (sessionId: string): Promise<Session> =>
  invoke<Session>('archive_codex_thread', { sessionId });

export const unarchiveCodexThread = (sessionId: string): Promise<Session> =>
  invoke<Session>('unarchive_codex_thread', { sessionId });

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

export const createPiSession = (workspaceId: string): Promise<Session> =>
  invoke<Session>('create_pi_session', { workspaceId });

export const sendPiPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('send_pi_prompt', { sessionId, input });

export const abortPiTurn = (sessionId: string): Promise<void> =>
  invoke('abort_pi_turn', { sessionId });

export const closePiSession = (sessionId: string): Promise<void> =>
  invoke('close_pi_session', { sessionId });

export const steerPiPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('steer_pi_prompt', { sessionId, input });

export const followUpPiPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('follow_up_pi_prompt', { sessionId, input });

export const getPiSessionTree = (sessionId: string): Promise<PiSessionTreeSnapshot> =>
  invoke<PiSessionTreeSnapshot>('get_pi_session_tree', { sessionId });

export const navigatePiSessionTree = (
  sessionId: string,
  entryId: string,
): Promise<PiSessionTreeNavigation> =>
  invoke<PiSessionTreeNavigation>('navigate_pi_session_tree', { sessionId, entryId });

export const getPiSessionSnapshot = (sessionId: string): Promise<PiSessionSnapshot> =>
  invoke<PiSessionSnapshot>('get_pi_session_snapshot', { sessionId });

export const listenToAgentEvents = (
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> => listen<AgentEvent>('agent-event', (event) => handler(event.payload));
