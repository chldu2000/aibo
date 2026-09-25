import type { Session } from '$lib/types';

export type WorkspaceSessionMap = Record<string, Session[]>;
export const WORKSPACE_SESSION_PAGE_SIZE = 5;

function activityTime(session: Session): number {
  const time = Date.parse(session.updatedAt);
  const created = Date.parse(session.createdAt);
  return Number.isFinite(time) ? time : Number.isFinite(created) ? created : 0;
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => activityTime(b) - activityTime(a)
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function upsertSession(
  sessionsByWorkspace: WorkspaceSessionMap,
  session: Session,
): WorkspaceSessionMap {
  const current = sessionsByWorkspace[session.workspaceId] ?? [];
  return {
    ...sessionsByWorkspace,
    [session.workspaceId]: sortSessions([
      session,
      ...current.filter(({ id }) => id !== session.id),
    ]),
  };
}

export function replaceSession(
  sessionsByWorkspace: WorkspaceSessionMap,
  session: Session,
): WorkspaceSessionMap {
  const current = sessionsByWorkspace[session.workspaceId] ?? [];
  return {
    ...sessionsByWorkspace,
    [session.workspaceId]: sortSessions(current.map((item) => (item.id === session.id ? session : item))),
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
  const loadedById = new Map(loaded.map((session) => [session.id, session]));

  return sortSessions([
    ...locallyChanged.map((session) => {
      const persisted = loadedById.get(session.id);
      // A concurrent state/label edit owns those fields, but must not hide
      // newer content activity returned by the host.
      return persisted && activityTime(persisted) > activityTime(session)
        ? { ...session, updatedAt: persisted.updatedAt } : session;
    }),
    ...loaded.filter(
      (session) => !locallyRemoved.has(session.id) && !locallyChangedIds.has(session.id),
    ),
  ]);
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
