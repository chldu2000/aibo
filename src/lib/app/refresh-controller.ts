import type {
  AgentDiagnostic,
  CodexThreadSummary,
  ContextAttachment,
  Artifact,
  ProjectAction,
  ProjectActionRun,
  PiSessionTreeSnapshot,
  Session,
  SessionExecutionProfile,
  SessionFilter,
  TurnChangeSet,
  WorkspaceChanges,
  Workspace,
  WorkspaceCapabilityInventory,
  RestoreOperation,
} from '$lib/types';
import type { PersistedSelection } from './selection-storage';
import { withTimeout } from './async-timeout';
import { ensureWorkspaceExpanded, reconcileSessionRefresh, workspaceIdsForRefresh } from './session-transitions';
import { toErrorMessage } from './error-utils';
import { createLatestRequestTracker } from './latest-request-tracker';

const SESSION_LIST_TIMEOUT_MS = 10_000;

export type RefreshControllerContext = {
  api: {
    listWorkspaces: () => Promise<Workspace[]>;
    probeAgents: () => Promise<AgentDiagnostic[]>;
    listSessions: (workspaceId: string, options: { search: string; statusFilter: SessionFilter }) => Promise<Session[]>;
    getTurnChangeSet: (sessionId: string, turnId?: string | null) => Promise<TurnChangeSet | null>;
    getWorkspaceChanges: (workspaceId: string) => Promise<WorkspaceChanges>;
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
  getSessionsLoadingWorkspaceIds: () => string[];
  setWorkspaces: (value: Workspace[]) => void;
  setDiagnostics: (value: AgentDiagnostic[]) => void;
  setSelectedWorkspaceId: (value: string | null) => void;
  setSelectedSessionId: (value: string | null) => void;
  setExpandedWorkspaceIds: (value: string[]) => void;
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setSessionsLoadingWorkspaceIds: (value: string[]) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
  clearSelectedSessionContext: () => void;
  refreshTimeline: (sessionId: string) => Promise<void>;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  refreshCodexThread: (sessionId: string) => Promise<void> | void;
  refreshPiTree: (sessionId: string) => Promise<void> | void;
  refreshExecutionProfile: (sessionId: string) => Promise<void> | void;
  refreshTurnChangeSet: (sessionId: string) => Promise<void> | void;
  refreshWorkspaceChanges: (workspaceId: string) => Promise<void> | void;
  refreshAttachments: (sessionId: string) => Promise<void> | void;
  refreshArtifacts: (sessionId: string) => Promise<void> | void;
  refreshProjectActions: (workspaceId: string) => Promise<void> | void;
  refreshWorkspaceCapabilities: (workspaceId: string) => Promise<void> | void;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setCodexThreadSnapshot: (value: null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setExecutionProfile: (value: SessionExecutionProfile | null) => void;
  setTurnChangeSet: (value: TurnChangeSet | null) => void;
  setWorkspaceChanges: (value: WorkspaceChanges | null) => void;
  setAttachments: (value: ContextAttachment[]) => void;
  setArtifacts: (value: Artifact[]) => void;
  setProjectActions: (value: ProjectAction[]) => void;
  setProjectActionRuns: (value: ProjectActionRun[]) => void;
  setWorkspaceCapabilities: (value: WorkspaceCapabilityInventory | null) => void;
  setRestoreOperations: (value: RestoreOperation[]) => void;
  setPiNavigationEntryId: (value: null) => void;
};

export function createRefreshController(context: RefreshControllerContext) {
  const sessionRequests = createLatestRequestTracker();

  function finishSessionListLoading(workspaceId: string, generation: number): void {
    if (!sessionRequests.isLatest(workspaceId, generation)) return;
    context.setSessionsLoadingWorkspaceIds(
      context.getSessionsLoadingWorkspaceIds().filter((id) => id !== workspaceId),
    );
  }

  async function refreshSelectedSessionContext(sessionId: string): Promise<void> {
    try {
      await context.refreshTimeline(sessionId);
      await context.refreshExecutionProfile(sessionId);
      await context.refreshTurnChangeSet(sessionId);
      await context.refreshAttachments(sessionId);
      await context.refreshArtifacts(sessionId);
      void context.refreshCodexThread(sessionId);
      void context.refreshPiTree(sessionId);
    } catch (error) {
      // Session list rendering must not be held hostage by a slow or failed
      // context request. The individual context panels keep their own
      // fallbacks; surface a timeline failure without re-entering loading.
      context.setErrorMessage(toErrorMessage(error));
    }
  }

  async function refreshSessions(workspaceId: string): Promise<void> {
    const generation = sessionRequests.begin(workspaceId);
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
      const loadedSessions = await withTimeout(
        context.api.listSessions(workspaceId, {
          search: context.getSessionSearch(),
          statusFilter: context.getSessionFilter(),
        }),
        SESSION_LIST_TIMEOUT_MS,
        '加载会话超时；已保留当前会话列表，请稍后重试。',
      );
      if (!sessionRequests.isLatest(workspaceId, generation)) return;
      const reconciledSessions = reconcileSessionRefresh(
        previousSessions,
        context.getWorkspaceSessions(workspaceId),
        loadedSessions,
      );
      context.setWorkspaceSessionMap({
        ...context.getWorkspaceSessionMap(),
        [workspaceId]: reconciledSessions,
      });
      // The list is ready now. Do not keep the sidebar on “加载会话…” while
      // the selected session's timeline/profile/context is hydrated below.
      finishSessionListLoading(workspaceId, generation);
      if (workspaceId !== context.getSelectedWorkspaceId()) return;
      // Navigation during the request owns the selected pane. A list response
      // may update its cache but must not clear or hydrate a newer selection.
      if (selectedSessionId !== context.getSelectedSessionId()) return;

      const rememberedSessionId =
        context.getRestoringSelection() && context.getPersistedSelection()?.workspaceId === workspaceId
          ? context.getPersistedSelection()?.sessionId ?? null
          : null;
      const selectedSessionIsVisible = Boolean(
        selectedSessionId && reconciledSessions.some(({ id }) => id === selectedSessionId),
      );
      const restoredSessionIsVisible = Boolean(
        rememberedSessionId && reconciledSessions.some(({ id }) => id === rememberedSessionId),
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
        // Hydrate the selected pane independently. A slow adapter/DB request
        // must not block the already-loaded workspace session list or the
        // completion of the global refresh operation.
        void refreshSelectedSessionContext(nextSelectedSessionId);
      } else {
        context.clearSelectedSessionContext();
      }
    } catch (error) {
      if (sessionRequests.isLatest(workspaceId, generation)) {
        context.setErrorMessage(toErrorMessage(error));
      }
    } finally {
      // Covers list_sessions failures and early returns before the list is
      // committed. For the successful path this is intentionally idempotent.
      finishSessionListLoading(workspaceId, generation);
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
        await context.refreshWorkspaceChanges(nextSelectedWorkspaceId);
        await context.refreshCodexThreads(nextSelectedWorkspaceId);
        await context.refreshProjectActions(nextSelectedWorkspaceId);
        await context.refreshWorkspaceCapabilities(nextSelectedWorkspaceId);
      } else {
        context.setWorkspaceSessionMap({});
        context.clearSelectedSessionContext();
        context.setCodexThreads([]);
        context.setCodexThreadSnapshot(null);
        context.setPiTree(null);
        context.setExecutionProfile(null);
        context.setTurnChangeSet(null);
        context.setWorkspaceChanges(null);
        context.setAttachments([]);
        context.setArtifacts([]);
        context.setProjectActions([]);
        context.setProjectActionRuns([]);
        context.setWorkspaceCapabilities(null);
        context.setRestoreOperations([]);
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
