import type {
  ApprovalRequest,
  Session,
  TimelineItem,
} from '$lib/types';
import {
  removeSession,
  replaceSession,
  upsertSession,
} from './session-transitions';
import { toErrorMessage } from './error-utils';

export type SessionLifecycleControllerContext = {
  api: {
    renameSession: (sessionId: string, label: string) => Promise<Session>;
    closeCodexSession: (sessionId: string) => Promise<void>;
    closePiSession: (sessionId: string) => Promise<void>;
    forkCodexThread: (sessionId: string) => Promise<Session>;
    archiveSession: (sessionId: string) => Promise<Session>;
    unarchiveSession: (sessionId: string) => Promise<Session>;
    getTimeline: (sessionId: string) => Promise<TimelineItem[]>;
  };
  getDesktop: () => boolean;
  getSelectedSessionId: () => string | null;
  getSelectedWorkspaceId: () => string | null;
  getArchivingSessionId: () => string | null;
  getArchiveConfirmationSessionId: () => string | null;
  getRenamingSessionId: () => string | null;
  getSessionLabelDraft: () => string;
  findSession: (sessionId: string) => Session | null;
  getWorkspaceSessions: (workspaceId: string) => Session[];
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setSelectedSessionId: (value: string | null) => void;
  setTimeline: (value: TimelineItem[]) => void;
  getPendingApprovals: () => ApprovalRequest[];
  setPendingApprovals: (value: ApprovalRequest[]) => void;
  setCodexThreadSnapshot: (value: null) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
  setArchiveConfirmationSessionId: (value: string | null) => void;
  setArchivingSessionId: (value: string | null) => void;
  setArchivingWorkspaceId: (value: string | null) => void;
  setRenamingSessionId: (value: string | null) => void;
  setSessionLabelDraft: (value: string) => void;
  clearSelectedSessionContext: () => void;
  activateWorkspace: (workspaceId: string) => void;
  refreshSessions: (workspaceId: string) => Promise<void>;
  refreshCodexThreads: (workspaceId: string, announce?: boolean) => Promise<void> | void;
  refreshCodexThread: (sessionId: string, announce?: boolean) => Promise<void> | void;
  isSessionRunning: (session: Session) => boolean;
};

export function createSessionLifecycleController(
  context: SessionLifecycleControllerContext,
) {
  const running = context.isSessionRunning;

  function beginRenameSession(sessionId: string | null): void {
    const session = sessionId ? context.findSession(sessionId) : null;
    if (!session || !context.getDesktop() || session.id === context.getArchivingSessionId()) return;
    context.setRenamingSessionId(session.id);
    context.setSessionLabelDraft(session.label);
  }

  function cancelRenameSession(): void {
    context.setRenamingSessionId(null);
    context.setSessionLabelDraft('');
  }

  async function saveSessionRename(): Promise<void> {
    const sessionId = context.getRenamingSessionId();
    const label = context.getSessionLabelDraft().trim();
    if (!sessionId || !label || !context.getDesktop()) return;
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const renamed = await context.api.renameSession(sessionId, label);
      context.setWorkspaceSessionMap(replaceSession(context.getWorkspaceSessionMap(), renamed));
      cancelRenameSession();
      context.setNotice('会话名称已更新。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function closeSession(sessionId: string | null): Promise<void> {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || target.id === context.getArchivingSessionId()) return;
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const closingId = target.id;
      const closingAgent = target.agent;
      if (target.agent === 'pi') await context.api.closePiSession(closingId);
      else await context.api.closeCodexSession(closingId);
      context.setWorkspaceSessionMap(removeSession(
        context.getWorkspaceSessionMap(),
        target.workspaceId,
        closingId,
      ));
      if (context.getSelectedSessionId() === closingId) context.clearSelectedSessionContext();
      context.setNotice(
        `${closingAgent === 'pi' ? 'Pi' : 'Codex'} 会话已关闭；已保存的时间线仍可在下次启动时读取。`,
      );
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function forkSession(sessionId: string | null): Promise<void> {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || target.archived || target.id === context.getArchivingSessionId()) return;
    if (running(target)) {
      context.setErrorMessage('请等待当前 turn 完成后再创建分支。');
      return;
    }
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const forked = await context.api.forkCodexThread(target.id);
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), forked));
      context.activateWorkspace(forked.workspaceId);
      context.setSelectedSessionId(forked.id);
      context.setTimeline(await context.api.getTimeline(forked.id));
      context.setCodexThreadSnapshot(null);
      void context.refreshCodexThread(forked.id);
      void context.refreshCodexThreads(context.getSelectedWorkspaceId() ?? forked.workspaceId);
      context.setNotice('Codex 分支已创建，已复制最近一条已完成 turn。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  function requestArchiveSession(sessionId: string | null): void {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || target.archived || context.getArchivingSessionId() !== null) return;
    if (running(target)) {
      context.setErrorMessage('请等待当前 turn 完成后再归档。');
      return;
    }
    context.setArchiveConfirmationSessionId(target.id);
  }

  async function confirmArchiveSession(): Promise<void> {
    const sessionId = context.getArchiveConfirmationSessionId();
    context.setArchiveConfirmationSessionId(null);
    if (!sessionId) return;
    const target = context.findSession(sessionId);
    if (!target || target.archived || context.getArchivingSessionId() !== null) return;
    context.setArchivingSessionId(target.id);
    context.setArchivingWorkspaceId(target.workspaceId);
    context.setErrorMessage(null);
    try {
      const archived = await context.api.archiveSession(sessionId);
      const invalidatedCurrentSession = context.getSelectedSessionId() === archived.id;
      context.setPendingApprovals(
        context.getPendingApprovals().filter((item) => item.sessionId !== archived.id),
      );
      if (invalidatedCurrentSession) context.clearSelectedSessionContext();
      void context.refreshCodexThreads(archived.workspaceId);
      await context.refreshSessions(archived.workspaceId);
      context.setNotice(`${archived.agent === 'pi' ? 'Pi 会话' : 'Codex 线程'}已归档；本地时间线仍保留。`);
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      if (context.getArchivingSessionId() === sessionId) {
        context.setArchivingSessionId(null);
        context.setArchivingWorkspaceId(null);
      }
    }
  }

  async function unarchiveSession(sessionId: string | null): Promise<void> {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || !target.archived) return;
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const restored = await context.api.unarchiveSession(target.id);
      context.activateWorkspace(restored.workspaceId);
      context.setSelectedSessionId(restored.id);
      context.setTimeline(await context.api.getTimeline(restored.id));
      if (restored.agent === 'codex') {
        void context.refreshCodexThread(restored.id, true);
        void context.refreshCodexThreads(restored.workspaceId);
      }
      await context.refreshSessions(restored.workspaceId);
      if (context.getWorkspaceSessions(restored.workspaceId).some((item) => item.id === restored.id)) {
        context.setSelectedSessionId(restored.id);
      }
      context.setNotice(`${restored.agent === 'pi' ? 'Pi 会话' : 'Codex 线程'}已取消归档，可以继续发送消息。`);
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return {
    beginRenameSession,
    cancelRenameSession,
    saveSessionRename,
    closeSession,
    forkSession,
    requestArchiveSession,
    confirmArchiveSession,
    unarchiveSession,
  };
}
