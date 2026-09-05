import type { AgentName, ExecutionProfile, Session, TimelineItem, Workspace } from '$lib/types';
import { toErrorMessage } from './error-utils';
import { upsertSession } from './session-transitions';

export type AgentSessionControllerContext = {
  api: {
    createCodexSession: (workspaceId: string, profile?: ExecutionProfile | null) => Promise<Session>;
    createPiSession: (workspaceId: string, profile?: ExecutionProfile | null) => Promise<Session>;
  };
  getDesktop: () => boolean;
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setSelectedSessionId: (value: string | null) => void;
  setTimeline: (value: TimelineItem[]) => void;
  setUsageSnapshot: (value: Record<string, unknown> | null) => void;
  setRetry: (prompt: string | null, reason: string | null) => void;
  setLastSubmittedPrompt: (value: string | null) => void;
  setPiTree: (value: null) => void;
  setPiNavigationEntryId: (value: string | null) => void;
  setCreateSessionWorkspaceId: (value: string | null) => void;
  getCreateProfileMode: () => 'read-only' | 'edit';
  setCreateProfileMode: (value: 'read-only' | 'edit') => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  refreshPiTree: (sessionId: string) => Promise<void> | void;
  refreshExecutionProfile: (sessionId: string) => Promise<void> | void;
};

export function createAgentSessionController(context: AgentSessionControllerContext) {
  function requestedProfile(agent: AgentName): ExecutionProfile {
    const editable = context.getCreateProfileMode() === 'edit';
    return {
      schema: 'aibo.execution-profile/v1',
      interactionMode: editable ? 'edit' : 'ask',
      approvalPolicy: editable ? 'on-request' : agent === 'codex' ? 'on-request' : 'never',
      filesystemPolicy: editable ? 'workspace-write' : 'read-only',
      commandPolicy: 'disabled',
      networkPolicy: 'disabled',
      model: null,
      reasoningEffort: null,
    };
  }

  function resetSessionContext(): void {
    context.setTimeline([]);
    context.setUsageSnapshot(null);
    context.setRetry(null, null);
    context.setLastSubmittedPrompt(null);
    context.setPiTree(null);
    context.setPiNavigationEntryId(null);
  }

  async function createCodex(workspace: Workspace | null): Promise<void> {
    if (!workspace) {
      context.setErrorMessage('请先选择一个工作区。');
      return;
    }
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；请在 Tauri 桌面模式中启动 Codex。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const session = await context.api.createCodexSession(workspace.id, requestedProfile('codex'));
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
      context.setSelectedSessionId(session.id);
      resetSessionContext();
      context.setCreateSessionWorkspaceId(null);
      void context.refreshCodexThreads(workspace.id);
      void context.refreshExecutionProfile(session.id);
      context.setNotice('Codex 会话已启动，可以发送第一条消息。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function createPi(workspace: Workspace | null): Promise<void> {
    if (!workspace) {
      context.setErrorMessage('请先选择一个工作区。');
      return;
    }
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；请在 Tauri 桌面模式中启动 Pi。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const session = await context.api.createPiSession(workspace.id, requestedProfile('pi'));
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
      context.setSelectedSessionId(session.id);
      resetSessionContext();
      context.setCreateSessionWorkspaceId(null);
      void context.refreshPiTree(session.id);
      void context.refreshExecutionProfile(session.id);
      context.setNotice('Pi SDK 会话已启动；工具权限由 Aibo Core profile 控制，Pi 本身不提供原生沙箱。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { createCodex, createPi };
}
