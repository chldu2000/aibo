import type { Session, Workspace } from '$lib/types';
import type { SessionListItem, WorkspaceListItem } from './view-types';
import { sessionAgentKind } from '$lib/app/agent-kind';
import { sessionProviderIcon, type SessionProviderInstallation } from '$lib/app/session-providers';
export { readUsageValue, toUsageValues } from '$lib/app/session-usage';
export type { UsageLimitValue, UsageSnapshot, UsageValues } from '$lib/app/session-usage';

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
  const { id, workspaceId, label, state, archived, updatedAt } = session;
  const agent = sessionAgentKind(session);
  return { id, workspaceId, agent, label, state, archived, updatedAt, canSyncSnapshot: session.capabilities.includes('session.snapshot') };
}

export function toSessionListItems(sessions: Session[]): SessionListItem[] {
  return sessions.map(toSessionListItem);
}

export function toSessionListItemsByWorkspace(
  sessionsByWorkspace: Record<string, Session[]>,
  installations: SessionProviderInstallation[] = [],
): Record<string, SessionListItem[]> {
  return Object.fromEntries(
    Object.entries(sessionsByWorkspace).map(([workspaceId, sessions]) => [
      workspaceId,
      sessions.map(session => ({ ...toSessionListItem(session), icon: sessionProviderIcon(installations, session) })),
    ]),
  );
}
