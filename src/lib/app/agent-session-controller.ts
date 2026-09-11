import type { AgentName, AgentQueueSnapshot, CheckpointFile, ContextAttachment, ExecutionProfile, Session, TimelineItem, Workspace } from '$lib/types';
import { builtinAgentCreation } from './compatibility/builtin-agent-creation';
import { withTimeout } from './async-timeout';
import { toErrorMessage } from './error-utils';
import { upsertSession } from './session-transitions';

const SESSION_CREATE_TIMEOUT_MS = 20_000;

export type AgentSessionControllerContext = {
  api: {
    createSession: (workspaceId: string, agentId: string, profile: ExecutionProfile) => Promise<Session>;
  };
  getDesktop: () => boolean;
  getSelectedWorkspaceId: () => string | null;
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
  async function create(agent: AgentName, workspace: Workspace | null): Promise<void> {
    if (!workspace) { context.setErrorMessage('请先选择一个工作区。'); return; }
    if (!context.getDesktop()) { context.setNotice('请在桌面模式中创建会话。'); return; }
    const { agentId, profile } = builtinAgentCreation(agent);
    const previousSessionIds = new Set(context.getWorkspaceSessionMap()[workspace.id]?.map(session => session.id) ?? []);
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const session = await withTimeout(context.api.createSession(workspace.id, agentId, profile), SESSION_CREATE_TIMEOUT_MS, '创建会话超时，请刷新会话列表查看结果。');
      context.setWorkspaceSessionMap(upsertSession(context.getWorkspaceSessionMap(), session));
      if (context.getSelectedWorkspaceId() !== workspace.id) return;
      context.clearSelectedSessionContext();
      context.setSelectedSessionId(session.id);
      context.setCreateSessionWorkspaceId(null);
      void context.refreshExecutionProfile(session.id);
      context.setNotice('会话已启动，可以发送第一条消息。');
    } catch (error) {
      // A timed-out create can still finish in the host; refreshing reveals its actual identity.
      await context.refreshSessions(workspace.id).catch(() => {});
      const candidates = context.getWorkspaceSessionMap()[workspace.id]?.filter(session => !previousSessionIds.has(session.id) && session.agent === agentId && session.state === 'idle') ?? [];
      const recovered = candidates.length === 1 ? candidates[0] : null;
      if (recovered && context.getSelectedWorkspaceId() === workspace.id) {
        context.clearSelectedSessionContext();
        context.setSelectedSessionId(recovered.id);
        context.setCreateSessionWorkspaceId(null);
        void context.refreshExecutionProfile(recovered.id);
        context.setNotice('会话已从本地记录恢复。');
      } else context.setErrorMessage(toErrorMessage(error));
    } finally { context.setBusy(false); }
  }
  return { createCodex: (workspace: Workspace | null) => create('codex', workspace), createPi: (workspace: Workspace | null) => create('pi', workspace) };
}
