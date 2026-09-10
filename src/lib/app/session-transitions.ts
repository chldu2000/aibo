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

/**
 * Apply a server refresh without undoing optimistic mutations that completed
 * after the request started. Objects retained by reference from `baseline`
 * are unchanged; new, removed, or replaced objects came from a local action.
 */
export function reconcileSessionRefresh(
  baseline: Session[],
  current: Session[],
  loaded: Session[],
): Session[] {
  const baselineById = new Map(baseline.map((session) => [session.id, session]));
  const currentById = new Map(current.map((session) => [session.id, session]));
  const locallyRemoved = new Set(
    baseline.filter((session) => !currentById.has(session.id)).map((session) => session.id),
  );
  const locallyChanged = current.filter(
    (session) => baselineById.get(session.id) !== session,
  );
  const locallyChangedIds = new Set(locallyChanged.map((session) => session.id));

  return [
    ...locallyChanged,
    ...loaded.filter(
      (session) => !locallyRemoved.has(session.id) && !locallyChangedIds.has(session.id),
    ),
  ];
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
