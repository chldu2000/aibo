import type { Session } from '$lib/types';

export type WorkspaceSessionMap = Record<string, Session[]>;

export function upsertSession(
  sessionsByWorkspace: WorkspaceSessionMap,
  session: Session,
): WorkspaceSessionMap {
  const current = sessionsByWorkspace[session.workspaceId] ?? [];
  return {
    ...sessionsByWorkspace,
    [session.workspaceId]: [
      session,
      ...current.filter(({ id }) => id !== session.id),
    ],
  };
}

export function replaceSession(
  sessionsByWorkspace: WorkspaceSessionMap,
  session: Session,
): WorkspaceSessionMap {
  const current = sessionsByWorkspace[session.workspaceId] ?? [];
  return {
    ...sessionsByWorkspace,
    [session.workspaceId]: current.map((item) => (item.id === session.id ? session : item)),
  };
}

export function removeSession(
  sessionsByWorkspace: WorkspaceSessionMap,
  workspaceId: string,
  sessionId: string,
): WorkspaceSessionMap {
  return {
    ...sessionsByWorkspace,
    [workspaceId]: (sessionsByWorkspace[workspaceId] ?? []).filter(({ id }) => id !== sessionId),
  };
}

export function removeWorkspace(
  sessionsByWorkspace: WorkspaceSessionMap,
  workspaceId: string,
): WorkspaceSessionMap {
  const { [workspaceId]: _removedSessions, ...remaining } = sessionsByWorkspace;
  return remaining;
}

export function ensureWorkspaceExpanded(expandedWorkspaceIds: string[], workspaceId: string): string[] {
  return expandedWorkspaceIds.includes(workspaceId)
    ? expandedWorkspaceIds
    : [...expandedWorkspaceIds, workspaceId];
}

export function toggleWorkspaceExpanded(expandedWorkspaceIds: string[], workspaceId: string): string[] {
  return expandedWorkspaceIds.includes(workspaceId)
    ? expandedWorkspaceIds.filter((id) => id !== workspaceId)
    : [...expandedWorkspaceIds, workspaceId];
}

export function workspaceIdsForRefresh(
  selectedWorkspaceId: string | null,
  expandedWorkspaceIds: string[],
): string[] {
  return Array.from(
    new Set([selectedWorkspaceId, ...expandedWorkspaceIds].filter((id): id is string => Boolean(id))),
  );
}
