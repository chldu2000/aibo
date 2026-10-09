import { localizedMessage } from '../../../packages/i18n/index.js';
import type { LocalizedText } from '../../../packages/i18n/index.js';
import type { SetNotice } from './notifications';
import type {
  ApprovalRequest,
  Session,
} from '$lib/types';
import {
  removeSession,
  replaceSession,
  upsertSession,
} from './session-transitions';
import { toErrorText } from './error-utils';

export type SessionLifecycleControllerContext = {
  api: {
    renameSession: (sessionId: string, label: string) => Promise<Session>;
    closeAgentSession: (sessionId: string) => Promise<void>;
    forkCodexThread: (sessionId: string, throughTurnId?: string | null) => Promise<Session>;
    archiveSession: (sessionId: string) => Promise<Session>;
    unarchiveSession: (sessionId: string) => Promise<Session>;
  };
  getDesktop: () => boolean;
  getSelectedSessionId: () => string | null;
  getSelectedWorkspaceId: () => string | null;
  getArchivingSessionId: () => string | null;
  getArchiveConfirmationSessionId: () => string | null;
  getRenamingSessionId: () => string | null;
  getSessionLabelDraft: () => string;
  findSession: (sessionId: string) => Session | null;
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  getPendingApprovals: () => ApprovalRequest[];
  setPendingApprovals: (value: ApprovalRequest[]) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: LocalizedText | null) => void;
  setNotice: SetNotice;
  setArchiveConfirmationSessionId: (value: string | null) => void;
  setArchivingSessionId: (value: string | null) => void;
  setArchivingWorkspaceId: (value: string | null) => void;
  setRenamingSessionId: (value: string | null) => void;
  setSessionLabelDraft: (value: string) => void;
  clearSelectedSessionContext: () => void;
  selectSession: (sessionId: string) => void;
  refreshSessions: (workspaceId: string) => Promise<void>;
  refreshCodexThreads: (workspaceId: string, announce?: boolean) => Promise<void> | void;
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
      context.setNotice(localizedMessage('app.sessionRenamed'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
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
      await context.api.closeAgentSession(closingId);
      context.setWorkspaceSessionMap(removeSession(
        context.getWorkspaceSessionMap(),
        target.workspaceId,
        closingId,
      ));
      if (context.getSelectedSessionId() === closingId) context.clearSelectedSessionContext();
      context.setNotice(
        localizedMessage('lifecycle.closed'), 'success',
      );
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function forkSession(sessionId: string | null, throughTurnId?: string): Promise<void> {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || target.archived || !target.capabilities.includes('session.fork') || target.id === context.getArchivingSessionId()) return;
    if (running(target)) {
      context.setErrorMessage(localizedMessage('lifecycle.forkBusy'));
      return;
    }
    context.setBusy(true);
    context.setErrorMessage(null);
    const selectedId = context.getSelectedSessionId();
    const workspaceId = context.getSelectedWorkspaceId();
    try {
      const forked = await context.api.forkCodexThread(target.id, throughTurnId);
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), forked));
      if (context.getSelectedSessionId() === selectedId && context.getSelectedWorkspaceId() === workspaceId) {
        context.selectSession(forked.id);
      }
      void context.refreshCodexThreads(forked.workspaceId);
      context.setNotice(throughTurnId
        ? localizedMessage('lifecycle.forkReply')
        : localizedMessage('lifecycle.forkLatest'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  function requestArchiveSession(sessionId: string | null): void {
    const target = sessionId ? context.findSession(sessionId) : null;
    if (!target || !context.getDesktop() || target.archived || context.getArchivingSessionId() !== null) return;
    if (running(target)) {
      context.setErrorMessage(localizedMessage('lifecycle.archiveBusy'));
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
      context.setNotice(localizedMessage('lifecycle.archived'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
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
    const selectedId = context.getSelectedSessionId();
    const workspaceId = context.getSelectedWorkspaceId();
    try {
      const restored = await context.api.unarchiveSession(target.id);
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), restored));
      if (context.getSelectedSessionId() === selectedId && context.getSelectedWorkspaceId() === workspaceId) {
        context.selectSession(restored.id);
      }
      if (restored.capabilities.includes('session.snapshot')) void context.refreshCodexThreads(restored.workspaceId);
      await context.refreshSessions(restored.workspaceId);
      context.setNotice(localizedMessage('lifecycle.unarchived'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
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
