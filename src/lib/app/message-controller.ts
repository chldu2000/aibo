import type { ApprovalRequest, ContextAttachment, ContextAttachmentValidation, Session, Workspace } from '$lib/types';
import { toErrorMessage } from './error-utils';
import { upsertSession } from './session-transitions';

export type MessageControllerContext = {
  api: {
    createCodexSession: (workspaceId: string) => Promise<Session>;
    sendCodexPrompt: (sessionId: string, input: string) => Promise<void>;
    sendPiPrompt: (sessionId: string, input: string) => Promise<void>;
    abortCodexTurn: (sessionId: string) => Promise<void>;
    abortPiTurn: (sessionId: string) => Promise<void>;
    steerPiPrompt: (sessionId: string, input: string) => Promise<void>;
    followUpPiPrompt: (sessionId: string, input: string) => Promise<void>;
    validateSessionAttachments: (sessionId: string) => Promise<ContextAttachmentValidation[]>;
  };
  getDesktop: () => boolean;
  getSelectedWorkspace: () => Workspace | null;
  getSelectedSession: () => Session | null;
  getSelectedSessionArchiving: () => boolean;
  getSessionRunning: () => boolean;
  getComposerText: () => string;
  setComposerText: (value: string) => void;
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
  refreshTurnChangeSet?: (sessionId: string) => Promise<void>;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
};

export function createMessageController(context: MessageControllerContext) {
  function withAttachmentContext(input: string): string {
    const attachments = context.getAttachments().filter((attachment) => attachment.turnId === null);
    if (attachments.length === 0) return input;
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
      .filter((attachment) => attachment.turnId === null && attachment.mediaType.startsWith('image/'))
      .map((attachment) => attachment.path);
  }

  async function sendPrompt(): Promise<void> {
    const input = context.getComposerText().trim();
    if (!input) return;
    const workspace = context.getSelectedWorkspace();
    if (!workspace) {
      context.setErrorMessage('请先选择一个工作区。');
      return;
    }
    const selectedSession = context.getSelectedSession();
    if (selectedSession?.archived) {
      context.setErrorMessage('已归档的会话不能继续发送消息，请先取消归档或创建分支。');
      return;
    }
    if (context.getSelectedSessionArchiving()) {
      context.setErrorMessage('该会话正在归档，请稍候。');
      return;
    }
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；请在 Tauri 桌面模式中发送真实 Codex 请求。');
      return;
    }

    if (selectedSession) {
      const unsupported = unsupportedAttachmentPaths();
      if (unsupported.length > 0) {
        context.setErrorMessage(`当前 Agent 不支持图片上下文：${unsupported.join('、')}`);
        return;
      }
      const validation = await context.api.validateSessionAttachments(selectedSession.id);
      const invalid = validation.filter((item) => item.status !== 'ready');
      if (invalid.length > 0) {
        context.setErrorMessage(`附件已变化或不可用：${invalid.map((item) => item.path).join('、')}`);
        return;
      }
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    context.setLastSubmittedPrompt(input);
    context.setPromptInFlight(true);
    const requestInput = withAttachmentContext(input);
    try {
      let session = selectedSession;
      if (!session) {
        session = await context.api.createCodexSession(workspace.id);
        context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
        context.setSelectedSessionId(session.id);
      }
      if (session.agent === 'pi') await context.api.sendPiPrompt(session.id, requestInput);
      else await context.api.sendCodexPrompt(session.id, requestInput);
      await context.refreshTimeline(session.id);
      context.setComposerText('');
      context.updateWorkspaceSessions(session.workspaceId, (items) =>
        items.map((item) => (item.id === session?.id ? { ...item, state: 'running' } : item)),
      );
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
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
      if (session.agent === 'pi') await context.api.abortPiTurn(session.id);
      else await context.api.abortCodexTurn(session.id);
      context.setPendingApprovals(
        context.getPendingApprovals().filter((approval) => approval.sessionId !== session.id),
      );
      context.updateWorkspaceSessions(session.workspaceId, (items) =>
        items.map((item) => (item.id === session.id ? { ...item, state: 'interrupted' } : item)),
      );
      await context.refreshTimeline(session.id);
      await context.refreshTurnChangeSet?.(session.id);
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function queuePiPrompt(mode: 'steer' | 'followUp'): Promise<void> {
    const input = context.getComposerText().trim();
    const session = context.getSelectedSession();
    if (!input || !session || session.agent !== 'pi' || !context.getDesktop()) return;
    const unsupported = unsupportedAttachmentPaths();
    if (unsupported.length > 0) {
      context.setErrorMessage(`当前 Agent 不支持图片上下文：${unsupported.join('、')}`);
      return;
    }
    const validation = await context.api.validateSessionAttachments(session.id);
    const invalid = validation.filter((item) => item.status !== 'ready');
    if (invalid.length > 0) {
      context.setErrorMessage(`附件已变化或不可用：${invalid.map((item) => item.path).join('、')}`);
      return;
    }
    context.setBusy(true);
    context.setErrorMessage(null);
    const requestInput = withAttachmentContext(input);
    try {
      if (mode === 'steer') await context.api.steerPiPrompt(session.id, requestInput);
      else await context.api.followUpPiPrompt(session.id, requestInput);
      await context.refreshTimeline(session.id);
      context.setComposerText('');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { sendPrompt, retryLastPrompt, abortPrompt, queuePiPrompt };
}
