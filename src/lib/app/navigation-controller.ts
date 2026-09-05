import type { CodexThreadSummary, Session, SessionExecutionProfile } from '$lib/types';
import {
  ensureWorkspaceExpanded,
  toggleWorkspaceExpanded,
} from './session-transitions';

export type NavigationControllerContext = {
  getDesktop: () => boolean;
  getSelectedWorkspaceId: () => string | null;
  getExpandedWorkspaceIds: () => string[];
  getCreateSessionWorkspaceId: () => string | null;
  getArchivingSessionId: () => string | null;
  findSession: (sessionId: string) => Session | null;
  setSelectedWorkspaceId: (value: string | null) => void;
  setSelectedSessionId: (value: string | null) => void;
  setExpandedWorkspaceIds: (value: string[]) => void;
  setCreateSessionWorkspaceId: (value: string | null) => void;
  setUsageSnapshot: (value: Record<string, unknown> | null) => void;
  setRetry: (prompt: string | null, reason: string | null) => void;
  setLastSubmittedPrompt: (value: string | null) => void;
  setExecutionProfile: (value: SessionExecutionProfile | null) => void;
  setTimelineVisibleCount: (value: number) => void;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setNotice: (value: string | null) => void;
  clearSelectedSessionContext: () => void;
  refreshSessions: (workspaceId: string) => Promise<void> | void;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  refreshTimeline: (sessionId: string) => Promise<void> | void;
  refreshCodexThread: (sessionId: string) => Promise<void> | void;
  refreshPiTree: (sessionId: string) => Promise<void> | void;
  refreshExecutionProfile: (sessionId: string) => Promise<void> | void;
};

/** Coordinates list navigation while keeping the open conversation stable. */
export function createNavigationController(context: NavigationControllerContext) {
  function activateWorkspace(workspaceId: string): void {
    const isCurrentWorkspace = workspaceId === context.getSelectedWorkspaceId();
    context.setSelectedWorkspaceId(workspaceId);
    context.setExpandedWorkspaceIds(
      ensureWorkspaceExpanded(context.getExpandedWorkspaceIds(), workspaceId),
    );
    if (!isCurrentWorkspace) {
      context.setCreateSessionWorkspaceId(null);
      context.clearSelectedSessionContext();
      context.setCodexThreads([]);
      if (context.getDesktop()) {
        void context.refreshSessions(workspaceId);
        void context.refreshCodexThreads(workspaceId);
      }
    }
  }

  function selectWorkspace(workspaceId: string): void {
    const isExpanded = context.getExpandedWorkspaceIds().includes(workspaceId);
    context.setExpandedWorkspaceIds(
      toggleWorkspaceExpanded(context.getExpandedWorkspaceIds(), workspaceId),
    );
    if (isExpanded) {
      if (context.getCreateSessionWorkspaceId() === workspaceId) {
        context.setCreateSessionWorkspaceId(null);
      }
    } else if (context.getDesktop()) {
      void context.refreshSessions(workspaceId);
      void context.refreshCodexThreads(workspaceId);
    }
    // Expanding or collapsing a workspace only changes the list context. Keep the
    // conversation currently open in the main pane until the user selects a session.
    context.setSelectedWorkspaceId(workspaceId);
    context.setNotice(null);
  }

  function selectSession(sessionId: string): void {
    const session = context.findSession(sessionId);
    if (!session || session.id === context.getArchivingSessionId()) return;
    activateWorkspace(session.workspaceId);
    context.setSelectedSessionId(session.id);
    context.setUsageSnapshot(null);
    context.setRetry(null, null);
    context.setLastSubmittedPrompt(null);
    context.setExecutionProfile(null);
    context.setTimelineVisibleCount(80);
    if (context.getDesktop()) {
      void context.refreshTimeline(session.id);
      void context.refreshCodexThread(session.id);
      void context.refreshPiTree(session.id);
      void context.refreshExecutionProfile(session.id);
    }
  }

  function toggleSessionCreator(workspaceId: string): void {
    activateWorkspace(workspaceId);
    context.setCreateSessionWorkspaceId(
      context.getCreateSessionWorkspaceId() === workspaceId ? null : workspaceId,
    );
  }

  return { activateWorkspace, selectWorkspace, selectSession, toggleSessionCreator };
}
