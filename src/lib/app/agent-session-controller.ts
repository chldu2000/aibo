import type { AgentName, AgentQueueSnapshot, CheckpointFile, ContextAttachment, ExecutionProfile, Session, TimelineItem, Workspace } from '$lib/types';
import { sessionAgentKind } from './agent-kind';
import { withTimeout } from './async-timeout';
import { toErrorMessage } from './error-utils';
import { upsertSession } from './session-transitions';

const SESSION_CREATE_TIMEOUT_MS = 20_000;

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
  setQueueSnapshot: (value: AgentQueueSnapshot | null) => void;
  setCheckpoints: (value: CheckpointFile[]) => void;
  setRetry: (prompt: string | null, reason: string | null) => void;
  setLastSubmittedPrompt: (value: string | null) => void;
  setPiTree: (value: null) => void;
  setAttachments: (value: ContextAttachment[]) => void;
  setPiNavigationEntryId: (value: string | null) => void;
  setCreateSessionWorkspaceId: (value: string | null) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
  clearSelectedSessionContext: () => void;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  refreshPiTree: (sessionId: string) => Promise<void> | void;
  refreshExecutionProfile: (sessionId: string) => Promise<void> | void;
  refreshSessions: (workspaceId: string) => Promise<void>;
};

export function createAgentSessionController(context: AgentSessionControllerContext) {
  function requestedProfile(agent: AgentName): ExecutionProfile {
    if (agent === 'codex') {
      return {
        schema: 'aibo.execution-profile/v1',
        interactionMode: 'ask',
        approvalPolicy: 'untrusted',
        filesystemPolicy: 'read-only',
        commandPolicy: 'approved',
        networkPolicy: 'disabled',
        model: null,
        reasoningEffort: null,
      };
    }
    return {
      schema: 'aibo.execution-profile/v1',
      interactionMode: 'ask',
      approvalPolicy: 'never',
      filesystemPolicy: 'read-only',
      commandPolicy: 'disabled',
      networkPolicy: 'disabled',
      model: null,
      reasoningEffort: null,
    };
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
      context.clearSelectedSessionContext();
      context.setSelectedSessionId(session.id);
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
    const previousSessionIds = new Set(
      context.getWorkspaceSessionMap()[workspace.id]?.map(({ id }) => id) ?? [],
    );
    try {
      const session = await withTimeout(
        context.api.createPiSession(workspace.id, requestedProfile('pi')),
        SESSION_CREATE_TIMEOUT_MS,
        '创建 Pi 会话超时。',
      );
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
      context.clearSelectedSessionContext();
      context.setSelectedSessionId(session.id);
      context.setCreateSessionWorkspaceId(null);
      void context.refreshPiTree(session.id);
      void context.refreshExecutionProfile(session.id);
      context.setNotice('Pi SDK 会话已启动；工具权限由 Aibo Core profile 控制，Pi 本身不提供原生沙箱。');
    } catch (error) {
      // The native command can finish after its IPC response is lost. Reload
      // the workspace and recover a newly-created idle Pi session instead of
      // leaving it invisible and encouraging a duplicate retry.
      try {
        await context.refreshSessions(workspace.id);
      } catch {
        // Preserve the original creation error if a custom controller context
        // still exposes a rejecting refresh implementation.
      }
      const recovered = context.getWorkspaceSessionMap()[workspace.id]?.find(
        (session) =>
          !previousSessionIds.has(session.id) &&
          sessionAgentKind(session) === 'pi' &&
          session.state === 'idle',
      );
      if (recovered) {
        context.clearSelectedSessionContext();
        context.setSelectedSessionId(recovered.id);
        context.setCreateSessionWorkspaceId(null);
        void context.refreshPiTree(recovered.id);
        void context.refreshExecutionProfile(recovered.id);
        context.setNotice('Pi 会话已创建；界面响应中断后已从本地会话记录恢复。');
      } else {
        context.setErrorMessage(toErrorMessage(error));
      }
    } finally {
      context.setBusy(false);
    }
  }

  return { createCodex, createPi };
}
