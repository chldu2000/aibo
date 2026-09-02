import { invoke } from '@tauri-apps/api/core';
import type { AgentDiagnostic, AppSnapshot, Workspace } from './types';

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
