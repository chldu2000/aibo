import type { Session, Workspace } from '$lib/types';
import type { SessionListItem, WorkspaceListItem } from './view-types';

export type UsageSnapshot = Record<string, unknown>;

export type UsageValues = {
  input: number | null;
  output: number | null;
  total: number | null;
};

/**
 * Convert domain records into the narrow data shape consumed by the sidebar.
 * Keeping this projection pure prevents presentation components from learning
 * about persistence-only fields as the domain model grows.
 */
export function toWorkspaceListItem(workspace: Workspace): WorkspaceListItem {
  const { id, label, path, trust } = workspace;
  return { id, label, path, trust };
}

export function toWorkspaceListItems(workspaces: Workspace[]): WorkspaceListItem[] {
  return workspaces.map(toWorkspaceListItem);
}

export function toSessionListItem(session: Session): SessionListItem {
  const { id, workspaceId, agent, label, state, archived, updatedAt } = session;
  return { id, workspaceId, agent, label, state, archived, updatedAt };
}

export function toSessionListItems(sessions: Session[]): SessionListItem[] {
  return sessions.map(toSessionListItem);
}

export function toSessionListItemsByWorkspace(
  sessionsByWorkspace: Record<string, Session[]>,
): Record<string, SessionListItem[]> {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspace).map(([workspaceId, sessions]) => [
      workspaceId,
      toSessionListItems(sessions),
    ]),
  );
}

export function readUsageValue(
  snapshot: UsageSnapshot | null | undefined,
  key: 'input' | 'output' | 'total',
): number | null {
  if (!snapshot) return null;

  const total = snapshot.total;
  if (key === 'total') {
    if (typeof snapshot.totalTokens === 'number') return snapshot.totalTokens;
    if (total && typeof total === 'object' && !Array.isArray(total)) {
      const value = (total as Record<string, unknown>).totalTokens;
      if (typeof value === 'number') return value;
    }
    return typeof total === 'number' ? total : null;
  }

  if (typeof snapshot[key] === 'number') return snapshot[key] as number;
  if (total && typeof total === 'object' && !Array.isArray(total)) {
    const value = (total as Record<string, unknown>)[`${key}Tokens`];
    if (typeof value === 'number') return value;
  }
  return null;
}

export function toUsageValues(snapshot: UsageSnapshot | null | undefined): UsageValues | null {
  if (!snapshot) return null;
  return {
    input: readUsageValue(snapshot, 'input'),
    output: readUsageValue(snapshot, 'output'),
    total: readUsageValue(snapshot, 'total'),
  };
}
