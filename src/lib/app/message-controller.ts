import { localizedMessage, localizedList } from '../../../packages/i18n/index.js';
import type { LocalizedText } from '../../../packages/i18n/index.js';
import type { SetNotice } from './notifications';
import type { ApprovalRequest, ContextAttachment, ContextAttachmentValidation, Session, Workspace } from '$lib/types';
import { withSessionReferenceContext } from './session-references';
import { createAgentFacade } from './agent-facade';
import { toErrorText, LocalizedError } from './error-utils';
import { upsertSession } from './session-transitions';

export type MessageControllerContext = {
  api: {
    createDefaultSession: (workspaceId: string) => Promise<Session>;
    sendAgentPrompt: (sessionId: string, input: string) => Promise<Session>;
    cancelAgentTurn: (sessionId: string) => Promise<void>;
    invokeAgentCapability: (sessionId: string, capability: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    validateSessionAttachments: (sessionId: string) => Promise<ContextAttachmentValidation[]>;
  };
  getDesktop: () => boolean;
  getSelectedWorkspace: () => Workspace | null;
  getSelectedSession: () => Session | null;
  getSelectedSessionArchiving: () => boolean;
  getSessionRunning: () => boolean;
  getComposerText: () => string;
  setComposerText: (value: string) => void;
  consumeDraft: (sessionId: string, submitted: string) => void;
  setComposerDraftStatus?: (sessionId: string, sendFailed: boolean) => void;
  getAttachments: () => ContextAttachment[];
  setAttachments: (value: ContextAttachment[]) => void;
  getRetryPrompt: () => string | null;
  setLastSubmittedPrompt: (value: string | null) => void;
  setPromptInFlight: (value: boolean) => void;
  setSelectedSessionId: (value: string | null) => void;
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  getPendingApprovals: () => ApprovalRequest[];
  setPendingApprovals: (value: ApprovalRequest[]) => void;
  updateWorkspaceSessions: (
    workspaceId: string,
    updater: (items: Session[]) => Session[],
  ) => void;
  refreshTimeline: (sessionId: string) => Promise<void>;
  refreshAttachments: (sessionId: string) => Promise<void>;
  refreshTurnChangeSet?: (sessionId: string) => Promise<void>;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: LocalizedText | null) => void;
  setNotice: SetNotice;
};

export function createMessageController(context: MessageControllerContext) {
  const agent = createAgentFacade(context.api);
  function withAttachmentContext(input: string, sessionId: string | null): string {
    input = withSessionReferenceContext(input, context.getAttachments(), sessionId);
    const attachments = context.getAttachments().filter((attachment) => attachment.sessionId === sessionId && attachment.turnId === null && attachment.mediaType !== 'application/vnd.aibo.session-reference+json');
    const request = attachments.length === 0 ? input : appendFileReferences(input, attachments);
    if (new TextEncoder().encode(request).length > 200_000 || new TextEncoder().encode(JSON.stringify({ text: request })).length > 240_000) {
      throw new LocalizedError('message.tooLarge');
    }
    return request;
  }

  function appendFileReferences(input: string, attachments: ContextAttachment[]): string {
    const references = attachments
      .map((attachment) => {
        const metadata = [attachment.mediaType, attachment.size === null ? null : `${attachment.size} bytes`, attachment.contentHash]
          .filter(Boolean)
          .join(', ');
        return `- ${attachment.path}${metadata ? ` (${metadata})` : ''} [attachment:${attachment.id}]`;
      })
      .join('\n');
    return `${input}\n\n[AIBO_CONTEXT_ATTACHMENTS]\n${references}\n[/AIBO_CONTEXT_ATTACHMENTS]`;
  }

  function unsupportedAttachmentPaths(): string[] {
    return context
      .getAttachments()
      .filter((attachment) => attachment.sessionId === context.getSelectedSession()?.id && attachment.turnId === null && attachment.mediaType.startsWith('image/') && attachment.sendStrategy !== 'inline')
      .map((attachment) => attachment.path);
  }

  async function sendPromptOnce(): Promise<void> {
    const draftText = context.getComposerText();
    const input = draftText.trim();
    if (!input && !context.getAttachments().some(item => item.sessionId === context.getSelectedSession()?.id && item.turnId === null && item.mediaType.startsWith('image/') && item.sendStrategy === 'inline')) return;
    const workspace = context.getSelectedWorkspace();
    if (!workspace) {
      context.setErrorMessage(localizedMessage('app.selectWorkspaceFirst'));
      return;
    }
    const selectedSession = context.getSelectedSession();
    if (selectedSession?.state === 'starting') {
      context.setNotice(localizedMessage('app.initializingDraft'), 'info');
      return;
    }
    const draftSessionId = selectedSession?.id ?? null;
    if (selectedSession?.archived) {
      context.setErrorMessage(localizedMessage('message.archived'));
      return;
    }
    if (context.getSelectedSessionArchiving()) {
      context.setErrorMessage(localizedMessage('message.archiving'));
      return;
    }
    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('message.desktopOnly'), 'warning');
      return;
    }

    if (selectedSession && context.getSessionRunning() && selectedSession.capabilities.includes('queue.manage')) {
      await queuePromptOnce('followUp');
      return;
    }

    let requestInput: string;
    try { requestInput = withAttachmentContext(input, draftSessionId); }
    catch (error) { context.setErrorMessage(toErrorText(error)); return; }
    if (selectedSession) {
      const unsupported = unsupportedAttachmentPaths();
      if (unsupported.length > 0) {
        context.setErrorMessage(localizedMessage('message.unsupportedImages', {paths: localizedList(unsupported)}));
        return;
      }
      const validation = await context.api.validateSessionAttachments(selectedSession.id);
      const invalid = validation.filter((item) => item.status !== 'ready');
      if (invalid.length > 0) {
        context.setErrorMessage(localizedMessage('message.invalidAttachments', {paths: localizedList(invalid.map(item => item.path))}));
        return;
      }
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    context.setLastSubmittedPrompt(input);
    context.setPromptInFlight(true);
    let acceptedSession: Session | null = null;
    try {
      let session = selectedSession;
      if (!session) {
        session = await context.api.createDefaultSession(workspace.id);
        context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
        if (context.getSelectedWorkspace()?.id === workspace.id && !context.getSelectedSession()) context.setSelectedSessionId(session.id);
      }
      session = await context.api.sendAgentPrompt(session.id, requestInput);
      acceptedSession = session;
      context.consumeDraft(session.id, draftText);
      context.setComposerDraftStatus?.(session.id, false);
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
      await Promise.all([context.refreshTimeline(session.id), context.refreshAttachments(session.id)]);
    } catch (error) {
      if (acceptedSession) {
        if (context.getSelectedSession()?.id === acceptedSession.id) {
          context.setNotice(localizedMessage('message.refreshFailed'), 'warning');
        }
      } else {
        if (draftSessionId) context.setComposerDraftStatus?.(draftSessionId, true);
        context.setErrorMessage(toErrorText(error));
      }
    } finally {
      context.setPromptInFlight(false);
      context.setBusy(false);
    }
  }

  async function retryLastPrompt(): Promise<void> {
    const retryPrompt = context.getRetryPrompt();
    if (!retryPrompt || !context.getSelectedSession() || context.getSessionRunning() || context.getSelectedSession()?.archived) {
      return;
    }
    context.setComposerText(retryPrompt);
    await sendPrompt();
  }

  async function abortPrompt(): Promise<void> {
    const session = context.getSelectedSession();
    if (!session || !context.getDesktop()) return;
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      await context.api.cancelAgentTurn(session.id);
      context.setPendingApprovals(
        context.getPendingApprovals().filter((approval) => approval.sessionId !== session.id),
      );
      context.updateWorkspaceSessions(session.workspaceId, (items) =>
        items.map((item) => (item.id === session.id ? { ...item, state: 'interrupted' } : item)),
      );
      await context.refreshTimeline(session.id);
      await context.refreshTurnChangeSet?.(session.id);
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function queuePromptOnce(mode: 'steer' | 'followUp'): Promise<void> {
    const draftText = context.getComposerText();
    const input = draftText.trim();
    const session = context.getSelectedSession();
    if ((!input && !context.getAttachments().some(item => item.sessionId === session?.id && item.turnId === null && item.mediaType.startsWith('image/') && item.sendStrategy === 'inline')) || !session || !session.capabilities.includes('queue.manage') || !context.getDesktop()) return;
    if (session.archived || context.getSelectedSessionArchiving()) return;
    if (mode === 'steer' && context.getSessionRunning() && !session.capabilities.includes('queue.steer')) return;
    let requestInput: string;
    try { requestInput = withAttachmentContext(input, session.id); }
    catch (error) { context.setErrorMessage(toErrorText(error)); return; }
    const unsupported = unsupportedAttachmentPaths();
    if (unsupported.length > 0) {
      context.setErrorMessage(localizedMessage('message.unsupportedImages', {paths: localizedList(unsupported)}));
      return;
    }
    const validation = await context.api.validateSessionAttachments(session.id);
    const invalid = validation.filter((item) => item.status !== 'ready');
    if (invalid.length > 0) {
      context.setErrorMessage(localizedMessage('message.invalidAttachments', {paths: localizedList(invalid.map(item => item.path))}));
      return;
    }
    context.setBusy(true);
    context.setErrorMessage(null);
    let accepted = false;
    try {
      await agent.invoke(session, 'queue.manage', { action: mode, message: requestInput });
      accepted = true;
      context.consumeDraft(session.id, draftText);
      context.setComposerDraftStatus?.(session.id, false);
      await Promise.all([context.refreshTimeline(session.id), context.refreshAttachments(session.id)]);
    } catch (error) {
      if (accepted) {
        if (context.getSelectedSession()?.id === session.id) context.setNotice(localizedMessage('message.queueRefreshFailed'), 'warning');
      } else context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  // Admission starts before async attachment validation so repeated clicks
  // cannot submit the same captured draft twice.
  let submitting = false;
  async function sendPrompt(): Promise<void> {
    if (submitting) return;
    submitting = true;
    try { await sendPromptOnce(); } finally { submitting = false; }
  }
  async function queuePrompt(mode: 'steer' | 'followUp'): Promise<void> {
    if (submitting) return;
    submitting = true;
    try { await queuePromptOnce(mode); } finally { submitting = false; }
  }
  return { sendPrompt, retryLastPrompt, abortPrompt, queuePrompt };
}
