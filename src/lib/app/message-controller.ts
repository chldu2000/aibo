import type { ApprovalRequest, Session, Workspace } from '$lib/types';
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
  };
  getDesktop: () => boolean;
  getSelectedWorkspace: () => Workspace | null;
  getSelectedSession: () => Session | null;
  getSelectedSessionArchiving: () => boolean;
  getSessionRunning: () => boolean;
  getComposerText: () => string;
  setComposerText: (value: string) => void;
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
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
};

export function createMessageController(context: MessageControllerContext) {
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

    context.setBusy(true);
    context.setErrorMessage(null);
    context.setLastSubmittedPrompt(input);
    context.setPromptInFlight(true);
    try {
      let session = selectedSession;
      if (!session) {
        session = await context.api.createCodexSession(workspace.id);
        context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
        context.setSelectedSessionId(session.id);
      }
      if (session.agent === 'pi') await context.api.sendPiPrompt(session.id, input);
      else await context.api.sendCodexPrompt(session.id, input);
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
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      if (mode === 'steer') await context.api.steerPiPrompt(session.id, input);
      else await context.api.followUpPiPrompt(session.id, input);
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
