import type {
  CodexThreadSnapshot,
  CodexThreadSummary,
  PiSessionTreeSnapshot,
  SessionExecutionProfile,
  Session,
  TimelineItem,
  TurnChangeSet,
} from '$lib/types';
import { toErrorMessage } from './error-utils';

export type SessionContextControllerContext = {
  api: {
    listCodexThreads: (workspaceId: string) => Promise<CodexThreadSummary[]>;
    readCodexThread: (sessionId: string) => Promise<CodexThreadSnapshot>;
    getTimeline: (sessionId: string) => Promise<TimelineItem[]>;
    getPiSessionTree: (sessionId: string) => Promise<PiSessionTreeSnapshot>;
    getSessionExecutionProfile: (sessionId: string) => Promise<SessionExecutionProfile>;
    getTurnChangeSet: (sessionId: string, turnId?: string | null) => Promise<TurnChangeSet | null>;
  };
  getDesktop: () => boolean;
  getSelectedWorkspaceId: () => string | null;
  getSelectedSessionId: () => string | null;
  getArchivingSessionId: () => string | null;
  findSession: (sessionId: string) => Session | null;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setCodexThreadSnapshot: (value: CodexThreadSnapshot | null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setExecutionProfile: (value: SessionExecutionProfile | null) => void;
  setTurnChangeSet: (value: TurnChangeSet | null) => void;
  setTimeline: (value: TimelineItem[]) => void;
  setTimelineVisibleCount: (value: number) => void;
  setThreadBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
};

/** Reads selected-session context and normalizes refresh feedback for the UI. */
export function createSessionContextController(context: SessionContextControllerContext) {
  async function refreshCodexThreads(
    workspaceId: string,
    announce = false,
  ): Promise<void> {
    if (!context.getDesktop()) return;
    try {
      const loadedThreads = await context.api.listCodexThreads(workspaceId);
      if (workspaceId === context.getSelectedWorkspaceId()) {
        context.setCodexThreads(loadedThreads);
      }
      if (announce) context.setNotice(`已读取 ${loadedThreads.length} 个 Codex 线程。`);
    } catch (error) {
      if (announce) context.setErrorMessage(toErrorMessage(error));
    }
  }

  async function refreshCodexThread(
    sessionId: string,
    announce = false,
  ): Promise<void> {
    if (sessionId === context.getArchivingSessionId()) return;
    const session = context.findSession(sessionId);
    if (
      !context.getDesktop() ||
      !session ||
      session.agent !== 'codex' ||
      session.archived ||
      !session.externalSessionId
    ) {
      if (sessionId === context.getSelectedSessionId()) {
        context.setCodexThreadSnapshot(null);
      }
      return;
    }
    try {
      const snapshot = await context.api.readCodexThread(sessionId);
      if (sessionId === context.getSelectedSessionId()) {
        context.setCodexThreadSnapshot(snapshot);
      }
      if (announce) context.setNotice(`已读取远端线程，共 ${snapshot.turnCount} 轮。`);
    } catch (error) {
      if (sessionId === context.getSelectedSessionId()) {
        context.setCodexThreadSnapshot(null);
      }
      if (announce) context.setErrorMessage(toErrorMessage(error));
    }
  }

  async function refreshTimeline(sessionId: string): Promise<void> {
    const loadedTimeline = await context.api.getTimeline(sessionId);
    if (sessionId === context.getSelectedSessionId()) {
      context.setTimeline(loadedTimeline);
      context.setTimelineVisibleCount(80);
    }
  }

  async function refreshExecutionProfile(sessionId: string): Promise<void> {
    if (!context.getDesktop()) {
      if (sessionId === context.getSelectedSessionId()) context.setExecutionProfile(null);
      return;
    }
    try {
      const profile = await context.api.getSessionExecutionProfile(sessionId);
      if (sessionId === context.getSelectedSessionId()) context.setExecutionProfile(profile);
    } catch (error) {
      if (sessionId === context.getSelectedSessionId()) context.setExecutionProfile(null);
      console.warn('unable to read session execution profile', error);
    }
  }

  async function refreshTurnChangeSet(sessionId: string): Promise<void> {
    if (!context.getDesktop()) {
      if (sessionId === context.getSelectedSessionId()) context.setTurnChangeSet(null);
      return;
    }
    try {
      const changeSet = await context.api.getTurnChangeSet(sessionId);
      if (sessionId === context.getSelectedSessionId()) context.setTurnChangeSet(changeSet);
    } catch (error) {
      if (sessionId === context.getSelectedSessionId()) context.setTurnChangeSet(null);
      console.warn('unable to read turn change set', error);
    }
  }

  async function refreshPiTree(sessionId: string): Promise<void> {
    if (sessionId === context.getArchivingSessionId()) return;
    const session = context.findSession(sessionId);
    if (!context.getDesktop() || !session || session.agent !== 'pi') {
      if (sessionId === context.getSelectedSessionId()) context.setPiTree(null);
      return;
    }
    try {
      const snapshot = await context.api.getPiSessionTree(sessionId);
      if (sessionId === context.getSelectedSessionId()) context.setPiTree(snapshot);
    } catch (error) {
      if (sessionId === context.getSelectedSessionId()) context.setPiTree(null);
      console.warn('unable to read Pi session tree', error);
    }
  }

  async function syncCodexThreads(): Promise<void> {
    const workspaceId = context.getSelectedWorkspaceId();
    if (!workspaceId || !context.getDesktop()) return;
    context.setThreadBusy(true);
    context.setErrorMessage(null);
    try {
      await refreshCodexThreads(workspaceId, true);
    } finally {
      context.setThreadBusy(false);
    }
  }

  async function syncCodexThread(sessionId: string): Promise<void> {
    context.setThreadBusy(true);
    context.setErrorMessage(null);
    try {
      await refreshCodexThread(sessionId, true);
    } finally {
      context.setThreadBusy(false);
    }
  }

  return {
    refreshCodexThreads,
    refreshCodexThread,
    refreshTimeline,
    refreshExecutionProfile,
    refreshTurnChangeSet,
    refreshPiTree,
    syncCodexThreads,
    syncCodexThread,
  };
}
