import type {
  AgentDiagnostic,
  CodexThreadSummary,
  PiSessionTreeSnapshot,
  Session,
  SessionFilter,
  Workspace,
} from '$lib/types';
import type { PersistedSelection } from './selection-storage';
import { ensureWorkspaceExpanded, workspaceIdsForRefresh } from './session-transitions';
import { toErrorMessage } from './error-utils';

export type RefreshControllerContext = {
  api: {
    listWorkspaces: () => Promise<Workspace[]>;
    probeAgents: () => Promise<AgentDiagnostic[]>;
    listSessions: (workspaceId: string, options: { search: string; statusFilter: SessionFilter }) => Promise<Session[]>;
  };
  getDesktop: () => boolean;
  getRestoringSelection: () => boolean;
  getPersistedSelection: () => PersistedSelection | null;
  getSelectedWorkspaceId: () => string | null;
  getSelectedSessionId: () => string | null;
  getExpandedWorkspaceIds: () => string[];
  getSessionSearch: () => string;
  getSessionFilter: () => SessionFilter;
  getWorkspaceSessions: (workspaceId: string) => Session[];
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  getSessionLoadGenerations: () => Record<string, number>;
  getSessionsLoadingWorkspaceIds: () => string[];
  setWorkspaces: (value: Workspace[]) => void;
  setDiagnostics: (value: AgentDiagnostic[]) => void;
  setSelectedWorkspaceId: (value: string | null) => void;
  setSelectedSessionId: (value: string | null) => void;
  setExpandedWorkspaceIds: (value: string[]) => void;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setSessionLoadGenerations: (value: Record<string, number>) => void;
  setSessionsLoadingWorkspaceIds: (value: string[]) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
  clearSelectedSessionContext: () => void;
  refreshTimeline: (sessionId: string) => Promise<void>;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  refreshCodexThread: (sessionId: string) => Promise<void> | void;
  refreshPiTree: (sessionId: string) => Promise<void> | void;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setCodexThreadSnapshot: (value: null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setPiNavigationEntryId: (value: null) => void;
};

export function createRefreshController(context: RefreshControllerContext) {
  async function refreshSessions(workspaceId: string): Promise<void> {
    const currentGeneration = context.getSessionLoadGenerations()[workspaceId] ?? 0;
    const generation = currentGeneration + 1;
    context.setSessionLoadGenerations({
      ...context.getSessionLoadGenerations(),
      [workspaceId]: generation,
    });
    if (!context.getSessionsLoadingWorkspaceIds().includes(workspaceId)) {
      context.setSessionsLoadingWorkspaceIds([
        ...context.getSessionsLoadingWorkspaceIds(),
        workspaceId,
      ]);
    }
    try {
      const previousSessions = context.getWorkspaceSessions(workspaceId);
      const selectedSessionId = context.getSelectedSessionId();
      const selectedSessionWasInWorkspace = Boolean(
        selectedSessionId && previousSessions.some(({ id }) => id === selectedSessionId),
      );
      const loadedSessions = await context.api.listSessions(workspaceId, {
        search: context.getSessionSearch(),
        statusFilter: context.getSessionFilter(),
      });
      if (context.getSessionLoadGenerations()[workspaceId] !== generation) return;
      context.setWorkspaceSessionMap({
        ...context.getWorkspaceSessionMap(),
        [workspaceId]: loadedSessions,
      });
      if (workspaceId !== context.getSelectedWorkspaceId()) return;

      const rememberedSessionId =
        context.getRestoringSelection() && context.getPersistedSelection()?.workspaceId === workspaceId
          ? context.getPersistedSelection()?.sessionId ?? null
          : null;
      const selectedSessionIsVisible = Boolean(
        selectedSessionId && loadedSessions.some(({ id }) => id === selectedSessionId),
      );
      const restoredSessionIsVisible = Boolean(
        rememberedSessionId && loadedSessions.some(({ id }) => id === rememberedSessionId),
      );
      if (!selectedSessionIsVisible && restoredSessionIsVisible) {
        context.setSelectedSessionId(rememberedSessionId);
      } else if (!selectedSessionIsVisible && !restoredSessionIsVisible) {
        if (selectedSessionWasInWorkspace || selectedSessionId === null) {
          context.clearSelectedSessionContext();
        }
        return;
      }
      const nextSelectedSessionId = context.getSelectedSessionId();
      if (nextSelectedSessionId) {
        await context.refreshTimeline(nextSelectedSessionId);
        void context.refreshCodexThread(nextSelectedSessionId);
        void context.refreshPiTree(nextSelectedSessionId);
      } else {
        context.clearSelectedSessionContext();
      }
    } finally {
      if (context.getSessionLoadGenerations()[workspaceId] === generation) {
        context.setSessionsLoadingWorkspaceIds(
          context.getSessionsLoadingWorkspaceIds().filter((id) => id !== workspaceId),
        );
      }
    }
  }

  async function refresh(): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；请在 Tauri 桌面模式中刷新本机诊断。');
      return;
    }
    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const [loadedWorkspaces, loadedDiagnostics] = await Promise.all([
        context.api.listWorkspaces(),
        context.api.probeAgents(),
      ]);
      context.setWorkspaces(loadedWorkspaces);
      context.setDiagnostics(loadedDiagnostics);
      const currentSelectedWorkspaceId = context.getSelectedWorkspaceId();
      const rememberedWorkspaceId = context.getRestoringSelection()
        ? context.getPersistedSelection()?.workspaceId ?? null
        : null;
      const nextSelectedWorkspaceId =
        rememberedWorkspaceId && loadedWorkspaces.some(({ id }) => id === rememberedWorkspaceId)
          ? rememberedWorkspaceId
          : currentSelectedWorkspaceId && loadedWorkspaces.some(({ id }) => id === currentSelectedWorkspaceId)
            ? currentSelectedWorkspaceId
            : (loadedWorkspaces[0]?.id ?? null);
      context.setSelectedWorkspaceId(nextSelectedWorkspaceId);
      const validWorkspaceIds = new Set(loadedWorkspaces.map(({ id }) => id));
      let expandedWorkspaceIds = context.getExpandedWorkspaceIds().filter((id) => validWorkspaceIds.has(id));
      if (nextSelectedWorkspaceId) {
        expandedWorkspaceIds = ensureWorkspaceExpanded(expandedWorkspaceIds, nextSelectedWorkspaceId);
      }
      context.setExpandedWorkspaceIds(expandedWorkspaceIds);
      if (nextSelectedWorkspaceId) {
        const workspaceIds = workspaceIdsForRefresh(nextSelectedWorkspaceId, expandedWorkspaceIds);
        await Promise.all(workspaceIds.map((id) => refreshSessions(id)));
        await context.refreshCodexThreads(nextSelectedWorkspaceId);
      } else {
        context.setWorkspaceSessionMap({});
        context.clearSelectedSessionContext();
        context.setCodexThreads([]);
        context.setCodexThreadSnapshot(null);
        context.setPiTree(null);
        context.setPiNavigationEntryId(null);
      }
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { refresh, refreshSessions };
}
