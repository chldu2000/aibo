import type { CodexThreadSummary, PiSessionTreeSnapshot, Session, Workspace } from '$lib/types';
import { toErrorMessage } from './error-utils';
import { ensureWorkspaceExpanded, removeWorkspace as removeWorkspaceState } from './session-transitions';

export type WorkspaceControllerContext = {
  api: {
    addWorkspace: (path: string) => Promise<Workspace>;
    setWorkspaceTrust: (workspaceId: string, trusted: boolean) => Promise<Workspace>;
    removeWorkspace: (workspaceId: string) => Promise<void>;
  };
  chooseDirectory: () => Promise<string | null>;
  getDesktop: () => boolean;
  getWorkspaces: () => Workspace[];
  setWorkspaces: (value: Workspace[]) => void;
  getSelectedWorkspaceId: () => string | null;
  getSelectedSessionId: () => string | null;
  getArchivingWorkspaceId: () => string | null;
  getWorkspaceSessions: (workspaceId: string) => Session[];
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  getExpandedWorkspaceIds: () => string[];
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setExpandedWorkspaceIds: (value: string[]) => void;
  setSelectedWorkspaceId: (value: string | null) => void;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setCodexThreadSnapshot: (value: null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setPiNavigationEntryId: (value: null) => void;
  clearSelectedSessionContext: () => void;
  refreshSessions: (workspaceId: string) => Promise<void> | void;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  selectWorkspace: (workspaceId: string) => void;
};

export function createWorkspaceController(context: WorkspaceControllerContext) {
  async function createWorkspace(path: string): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      context.setErrorMessage('请选择一个已经存在的本地目录。');
      return;
    }

    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；工作区变更需要在 Tauri 桌面模式中保存。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    context.setNotice(null);
    try {
      const workspace = await context.api.addWorkspace(normalizedPath);
      context.setWorkspaces([
        workspace,
        ...context.getWorkspaces().filter(({ id }) => id !== workspace.id),
      ]);
      context.selectWorkspace(workspace.id);
      context.setNotice('工作区已添加。首次运行 Agent 前请明确确认信任状态。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function chooseWorkspaceDirectory(): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；请在 Tauri 桌面模式中使用系统目录选择器。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const selectedPath = await context.chooseDirectory();
      if (selectedPath?.trim()) await createWorkspace(selectedPath);
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function toggleTrust(workspace: Workspace): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；信任状态只会在 Tauri 桌面模式中写入。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const updated = await context.api.setWorkspaceTrust(
        workspace.id,
        workspace.trust !== 'trusted',
      );
      context.setWorkspaces(
        context.getWorkspaces().map((item) => (item.id === updated.id ? updated : item)),
      );
      context.setNotice(updated.trust === 'trusted' ? '工作区已标记为可信。' : '工作区已撤销信任。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function deleteWorkspace(workspace: Workspace): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；删除操作需要在 Tauri 桌面模式中执行。');
      return;
    }
    if (workspace.id === context.getArchivingWorkspaceId()) return;

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const deletingSelectedWorkspace = context.getSelectedWorkspaceId() === workspace.id;
      const deletingSelectedSession = Boolean(
        context.getSelectedSessionId() &&
          context.getWorkspaceSessions(workspace.id).some(({ id }) => id === context.getSelectedSessionId()),
      );
      await context.api.removeWorkspace(workspace.id);
      context.setWorkspaces(context.getWorkspaces().filter(({ id }) => id !== workspace.id));
      context.setWorkspaceSessionMap(removeWorkspaceState(context.getWorkspaceSessionMap(), workspace.id));
      context.setExpandedWorkspaceIds(
        context.getExpandedWorkspaceIds().filter((id) => id !== workspace.id),
      );
      const remainingWorkspaces = context.getWorkspaces();
      const nextSelectedWorkspaceId = deletingSelectedWorkspace
        ? (remainingWorkspaces[0]?.id ?? null)
        : context.getSelectedWorkspaceId();
      context.setSelectedWorkspaceId(nextSelectedWorkspaceId);
      if (deletingSelectedSession) context.clearSelectedSessionContext();
      if (deletingSelectedWorkspace) {
        context.setCodexThreads([]);
        context.setCodexThreadSnapshot(null);
        context.setPiTree(null);
        context.setPiNavigationEntryId(null);
      }
      if (deletingSelectedWorkspace && nextSelectedWorkspaceId) {
        context.setExpandedWorkspaceIds(
          ensureWorkspaceExpanded(context.getExpandedWorkspaceIds(), nextSelectedWorkspaceId),
        );
        void context.refreshSessions(nextSelectedWorkspaceId);
        void context.refreshCodexThreads(nextSelectedWorkspaceId);
      }
      context.setNotice('工作区已从 Aibo 移除；本地目录未被删除。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { createWorkspace, chooseWorkspaceDirectory, toggleTrust, deleteWorkspace };
}
