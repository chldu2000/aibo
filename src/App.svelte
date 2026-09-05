<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import {
    AppOverlays,
    Inspector,
    SettingsPanel,
    TimelinePanel,
    WindowTitlebar,
    WorkspaceSidebar,
    toSessionListItemsByWorkspace,
    toUsageValues,
    toWorkspaceListItems,
    toolLabel,
  } from '$lib/components/app';
  import {
    readPersistedSelection as readSelectionFromStorage,
    writePersistedSelection as writeSelectionToStorage,
  } from '$lib/app/selection-storage';
  import { handleAgentEvent as processAgentEvent } from '$lib/app/agent-event-handler';
  import { createApprovalController } from '$lib/app/approval-controller';
  import { toErrorMessage } from '$lib/app/error-utils';
  import { createSessionLifecycleController } from '$lib/app/session-lifecycle-controller';
  import { createAgentSessionController } from '$lib/app/agent-session-controller';
  import { createSessionContextController } from '$lib/app/session-context-controller';
  import { createRefreshController } from '$lib/app/refresh-controller';
  import { createMessageController } from '$lib/app/message-controller';
  import { createNavigationController } from '$lib/app/navigation-controller';
  import { createPiTreeController } from '$lib/app/pi-tree-controller';
  import { createWorkspaceController } from '$lib/app/workspace-controller';
  import { workspaceIdsForRefresh } from '$lib/app/session-transitions';
  import type { PersistedSelection } from '$lib/app/selection-storage';
  import { isSessionRunning } from '$lib/app/session-state';
  import {
    addWorkspace,
    abortCodexTurn,
    archiveSession as archiveSessionApi,
    createCodexSession,
    createPiSession,
    closeCodexSession,
    closePiSession,
    forkCodexThread,
    getSessionExecutionProfile,
    getTimeline,
    getPiSessionTree,
    isTauri,
    listCodexThreads,
    listWorkspaces,
    listSessions,
    listenToAgentEvents,
    navigatePiSessionTree,
    probeAgents,
    readCodexThread,
    renameSession as renameSessionApi,
    removeWorkspace,
    resolveCodexApproval,
    sendCodexPrompt,
    sendPiPrompt,
    steerPiPrompt,
    followUpPiPrompt,
    abortPiTurn,
    setWorkspaceTrust,
    unarchiveSession as unarchiveSessionApi,
  } from './lib/api';
  import type {
    AgentDiagnostic,
    AgentEvent,
    ApprovalDecision,
    ApprovalRequest,
    CodexThreadSnapshot,
    CodexThreadSummary,
    Session,
    SessionExecutionProfile,
    SessionFilter,
    PiSessionTreeSnapshot,
    TimelineItem,
    Workspace,
  } from './lib/types';
  import type { SessionListItem, WorkspaceListItem } from './lib/components/app/view-types';
  import {
    activeTheme,
    activeThemeStyle,
    activeUiKitName,
    availableUiKits,
    setUiKit,
    setUiTheme,
  } from '$lib/ui-kit';

  const previewWorkspaces: Workspace[] = [
    {
      id: 'preview-workspace',
      path: '/Users/you/Workspace/example',
      label: 'example',
      trust: 'untrusted',
      lastOpenedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const previewDiagnostics: AgentDiagnostic[] = [
    {
      agent: 'codex',
      label: 'Codex',
      status: 'ready',
      executable: '/usr/local/bin/codex',
      version: 'detected at runtime',
      capabilities: ['app-server', 'streaming', 'approval'],
      authState: 'delegated',
      message: 'Web preview; desktop mode probes the local installation.',
    },
    {
      agent: 'pi',
      label: 'Pi',
      status: 'ready',
      executable: null,
      version: 'SDK 0.84.4',
      capabilities: ['sdk-host', 'streaming', 'abort', 'session-tree', 'session-tree-navigation', 'session-snapshot', 'read-only-tools'],
      authState: 'delegated',
      message: 'Project-locked SDK host; read-only tools only; native authentication remains with Pi.',
    },
  ];

  function readPersistedSelection(): PersistedSelection | null {
    if (typeof window === 'undefined') return null;
    try {
      return readSelectionFromStorage(window.localStorage);
    } catch {
      return null;
    }
  }

  function writePersistedSelection(selection: PersistedSelection | null) {
    if (typeof window === 'undefined') return;
    try {
      writeSelectionToStorage(window.localStorage, selection);
    } catch {
      // The WebView may reject localStorage access altogether.
    }
  }

  let workspaces = $state<Workspace[]>([]);
  let diagnostics = $state<AgentDiagnostic[]>([]);
  let workspaceSessionMap = $state<Record<string, Session[]>>({});
  let timeline = $state<TimelineItem[]>([]);
  let pendingApprovals = $state<ApprovalRequest[]>([]);
  let codexThreads = $state<CodexThreadSummary[]>([]);
  let codexThreadSnapshot = $state<CodexThreadSnapshot | null>(null);
  let piTree = $state<PiSessionTreeSnapshot | null>(null);
  let executionProfile = $state<SessionExecutionProfile | null>(null);
  let selectedWorkspaceId = $state<string | null>(null);
  let expandedWorkspaceIds = $state<string[]>([]);
  let selectedSessionId = $state<string | null>(null);
  let persistedSelection = $state<PersistedSelection | null>(null);
  let restoringSelection = $state(false);
  let sessionsLoadingWorkspaceIds = $state<string[]>([]);
  let sessionLoadGenerations = $state<Record<string, number>>({});
  let composerText = $state('');
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let desktop = $state(false);
  let threadBusy = $state(false);
  let archiveConfirmationSessionId = $state<string | null>(null);
  let archivingSessionId = $state<string | null>(null);
  let archivingWorkspaceId = $state<string | null>(null);
  let piNavigationEntryId = $state<string | null>(null);
  let sessionSearch = $state('');
  let sessionFilter = $state<SessionFilter>('active');
  let sessionSearchOpen = $state(false);
  let sessionFilterOpen = $state(false);
  let createSessionWorkspaceId = $state<string | null>(null);
  let renamingSessionId = $state<string | null>(null);
  let sessionLabelDraft = $state('');
  let timelineVisibleCount = $state(80);
  let usageSnapshot = $state<Record<string, unknown> | null>(null);
  let retryPrompt = $state<string | null>(null);
  let retryReason = $state<string | null>(null);
  let lastSubmittedPrompt = $state<string | null>(null);
  let settingsOpen = $state(false);
  let promptInFlight = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const sessions = $derived(workspaceSessionMap[selectedWorkspaceId ?? ''] ?? []);

  const workspaceItems = $derived<WorkspaceListItem[]>(toWorkspaceListItems(workspaces));

  const sessionItemsByWorkspace = $derived(
    toSessionListItemsByWorkspace(workspaceSessionMap),
  );

  const usageValues = $derived(toUsageValues(usageSnapshot));

  const selectedSession = $derived.by(() => {
    if (!selectedSessionId) return null;
    for (const workspaceSessions of Object.values(workspaceSessionMap)) {
      const session = workspaceSessions.find((item) => item.id === selectedSessionId);
      if (session) return session;
    }
    return null;
  });

  $effect(() => {
    if (desktop && !restoringSelection) {
      writePersistedSelection(
        selectedSession
          ? { workspaceId: selectedSession.workspaceId, sessionId: selectedSession.id }
          : null,
      );
    }
  });

  const sessionRunning = $derived(isSessionRunning(selectedSession));
  const selectedSessionArchiving = $derived(
    selectedSessionId !== null && selectedSessionId === archivingSessionId,
  );
  const selectedApprovals = $derived(
    pendingApprovals.filter((approval) => approval.sessionId === selectedSessionId),
  );
  const agentActivityLabel = $derived.by(() => {
    if (!selectedSession) return null;
    if (selectedSessionArchiving) return '正在归档会话…';
    if (!sessionRunning && !promptInFlight) return null;
    if (selectedSession.state === 'waiting_approval' || selectedApprovals.length > 0) {
      return '等待你的确认…';
    }
    const latest = timeline.at(-1);
    const agentLabel = selectedSession.agent === 'pi' ? 'Pi' : 'Codex';
    if (latest?.role === 'tool' && latest.status === 'streaming') {
      return `${agentLabel} 正在调用 ${toolLabel(latest)}…`;
    }
    return `${agentLabel} 正在响应…`;
  });

  $effect(() => {
    const message = notice;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    if (!message) return;
    const timer = setTimeout(() => {
      if (notice === message) notice = null;
      noticeTimer = undefined;
    }, 3600);
    noticeTimer = timer;
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const message = errorMessage;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = undefined;
    if (!message) return;
    const timer = setTimeout(() => {
      if (errorMessage === message) errorMessage = null;
      errorTimer = undefined;
    }, 6000);
    errorTimer = timer;
    return () => clearTimeout(timer);
  });

  onMount(() => {
    let stopListening: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      const runningDesktop = isTauri();
      if (!runningDesktop) {
        workspaces = previewWorkspaces;
        diagnostics = previewDiagnostics;
        selectedWorkspaceId = previewWorkspaces[0]?.id ?? null;
        expandedWorkspaceIds = selectedWorkspaceId ? [selectedWorkspaceId] : [];
        return;
      }

      restoringSelection = true;
      persistedSelection = readPersistedSelection();
      desktop = true;

      const unlisten = await listenToAgentEvents(handleAgentEvent);
      if (disposed) {
        unlisten();
        restoringSelection = false;
        return;
      }
      stopListening = unlisten;
      try {
        await refresh();
      } finally {
        restoringSelection = false;
      }
    })();

    return () => {
      disposed = true;
      stopListening?.();
    };
  });

  async function refresh() {
    await refreshController.refresh();
  }

  async function refreshSessions(workspaceId: string) {
    await refreshController.refreshSessions(workspaceId);
  }

  async function refreshExpandedSessions() {
    const workspaceIds = workspaceIdsForRefresh(selectedWorkspaceId, expandedWorkspaceIds);
    await Promise.all(workspaceIds.map((id) => refreshSessions(id)));
  }

  function getWorkspaceSessions(workspaceId: string): Session[] {
    return workspaceSessionMap[workspaceId] ?? [];
  }

  function updateWorkspaceSessions(workspaceId: string, updater: (items: Session[]) => Session[]) {
    workspaceSessionMap = {
      ...workspaceSessionMap,
      [workspaceId]: updater(getWorkspaceSessions(workspaceId)),
    };
  }

  function findSession(sessionId: string): Session | null {
    for (const workspaceSessions of Object.values(workspaceSessionMap)) {
      const session = workspaceSessions.find((item) => item.id === sessionId);
      if (session) return session;
    }
    return null;
  }

  function clearSelectedSessionContext() {
    selectedSessionId = null;
    timeline = [];
    codexThreadSnapshot = null;
    piTree = null;
    executionProfile = null;
    piNavigationEntryId = null;
    usageSnapshot = null;
    retryPrompt = null;
    retryReason = null;
    lastSubmittedPrompt = null;
  }

  async function refreshCodexThreads(workspaceId: string, announce = false) {
    await sessionContextController.refreshCodexThreads(workspaceId, announce);
  }

  async function refreshCodexThread(sessionId: string, announce = false) {
    await sessionContextController.refreshCodexThread(sessionId, announce);
  }

  async function syncCodexThreads() {
    await sessionContextController.syncCodexThreads();
  }

  async function syncCodexThread(sessionId: string) {
    await sessionContextController.syncCodexThread(sessionId);
  }

  async function refreshTimeline(sessionId: string) {
    await sessionContextController.refreshTimeline(sessionId);
  }

  async function refreshPiTree(sessionId: string) {
    await sessionContextController.refreshPiTree(sessionId);
  }

  function loadOlderTimeline() {
    timelineVisibleCount = Math.min(timeline.length, timelineVisibleCount + 80);
  }

  function handleTimelineScroll(event: Event) {
    const target = event.currentTarget as HTMLElement;
    if (target.scrollTop < 48 && timeline.length > timelineVisibleCount) loadOlderTimeline();
  }

  function handleAgentEvent(event: AgentEvent) {
    processAgentEvent(event, {
      selectedSessionId,
      selectedAgent: selectedSession?.agent ?? null,
      timeline,
      pendingApprovals,
      lastSubmittedPrompt,
      updateWorkspaceSessions,
      setPendingApprovals: (approvals) => (pendingApprovals = approvals),
      setUsageSnapshot: (usage) => (usageSnapshot = usage),
      setTimeline: (nextTimeline) => (timeline = nextTimeline),
      setRetry: (prompt, reason) => {
        retryPrompt = prompt;
        retryReason = reason;
      },
      setNotice: (message) => (notice = message),
      refreshSessions,
    });
  }

  async function createWorkspace(path: string) {
    await workspaceController.createWorkspace(path);
  }

  async function chooseWorkspaceDirectory() {
    await workspaceController.chooseWorkspaceDirectory();
  }

  async function createCodex() {
    await agentSessionController.createCodex(selectedWorkspace);
  }

  async function createPi() {
    await agentSessionController.createPi(selectedWorkspace);
  }

  async function sendPrompt() {
    await messageController.sendPrompt();
  }

  async function retryLastPrompt() {
    await messageController.retryLastPrompt();
  }

  async function abortPrompt() {
    await messageController.abortPrompt();
  }

  async function queuePiPrompt(mode: 'steer' | 'followUp') {
    await messageController.queuePiPrompt(mode);
  }

  function requestPiTreeNavigation(entryId: string) {
    piTreeController.requestNavigation(entryId);
  }

  async function confirmPiTreeNavigation() {
    await piTreeController.confirmNavigation();
  }

  async function resolveApproval(approval: ApprovalRequest, decision: ApprovalDecision) {
    await approvalController.resolveApproval(approval, decision);
  }

  function beginRenameSession(sessionId = selectedSessionId) {
    sessionLifecycle.beginRenameSession(sessionId);
  }

  function cancelRenameSession() {
    sessionLifecycle.cancelRenameSession();
  }

  async function saveSessionRename() {
    await sessionLifecycle.saveSessionRename();
  }

  async function closeSession(sessionId = selectedSessionId) {
    await sessionLifecycle.closeSession(sessionId);
  }

  async function forkSession(sessionId = selectedSessionId) {
    await sessionLifecycle.forkSession(sessionId);
  }

  function requestArchiveSession(sessionId = selectedSessionId) {
    sessionLifecycle.requestArchiveSession(sessionId);
  }

  async function confirmArchiveSession() {
    await sessionLifecycle.confirmArchiveSession();
  }

  async function unarchiveSession(sessionId = selectedSessionId) {
    await sessionLifecycle.unarchiveSession(sessionId);
  }

  function selectSession(id: string) {
    navigationController.selectSession(id);
  }

  async function toggleTrust(workspace: Workspace) {
    await workspaceController.toggleTrust(workspace);
  }

  async function deleteWorkspace(workspace: Workspace) {
    await workspaceController.deleteWorkspace(workspace);
  }

  function activateWorkspace(id: string) {
    navigationController.activateWorkspace(id);
  }

  function selectWorkspace(id: string) {
    navigationController.selectWorkspace(id);
  }

  function toggleSessionCreator(workspaceId: string) {
    navigationController.toggleSessionCreator(workspaceId);
  }

  const sessionContextController = createSessionContextController({
    api: {
      listCodexThreads,
      readCodexThread,
      getTimeline,
      getPiSessionTree,
      getSessionExecutionProfile,
    },
    getDesktop: () => desktop,
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    getSelectedSessionId: () => selectedSessionId,
    getArchivingSessionId: () => archivingSessionId,
    findSession,
    setCodexThreads: (value) => (codexThreads = value),
    setCodexThreadSnapshot: (value) => (codexThreadSnapshot = value),
    setPiTree: (value) => (piTree = value),
    setExecutionProfile: (value) => (executionProfile = value),
    setTimeline: (value) => (timeline = value),
    setTimelineVisibleCount: (value) => (timelineVisibleCount = value),
    setThreadBusy: (value) => (threadBusy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

  const navigationController = createNavigationController({
    getDesktop: () => desktop,
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    getExpandedWorkspaceIds: () => expandedWorkspaceIds,
    getCreateSessionWorkspaceId: () => createSessionWorkspaceId,
    getArchivingSessionId: () => archivingSessionId,
    findSession,
    setSelectedWorkspaceId: (value) => (selectedWorkspaceId = value),
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setExpandedWorkspaceIds: (value) => (expandedWorkspaceIds = value),
    setCreateSessionWorkspaceId: (value) => (createSessionWorkspaceId = value),
    setUsageSnapshot: (value) => (usageSnapshot = value),
    setRetry: (prompt, reason) => {
      retryPrompt = prompt;
      retryReason = reason;
    },
    setLastSubmittedPrompt: (value) => (lastSubmittedPrompt = value),
    setExecutionProfile: (value) => (executionProfile = value),
    setTimelineVisibleCount: (value) => (timelineVisibleCount = value),
    setCodexThreads: (value) => (codexThreads = value),
    setNotice: (value) => (notice = value),
    clearSelectedSessionContext,
    refreshSessions,
    refreshCodexThreads,
    refreshTimeline,
    refreshCodexThread,
    refreshPiTree,
    refreshExecutionProfile,
  });

  const sessionLifecycle = createSessionLifecycleController({
    api: {
      renameSession: renameSessionApi,
      closeCodexSession,
      closePiSession,
      forkCodexThread,
      archiveSession: archiveSessionApi,
      unarchiveSession: unarchiveSessionApi,
      getTimeline,
    },
    getDesktop: () => desktop,
    getSelectedSessionId: () => selectedSessionId,
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    getArchivingSessionId: () => archivingSessionId,
    getArchiveConfirmationSessionId: () => archiveConfirmationSessionId,
    getRenamingSessionId: () => renamingSessionId,
    getSessionLabelDraft: () => sessionLabelDraft,
    findSession,
    getWorkspaceSessions,
    getWorkspaceSessionMap: () => workspaceSessionMap,
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setTimeline: (value) => (timeline = value),
    getPendingApprovals: () => pendingApprovals,
    setPendingApprovals: (value) => (pendingApprovals = value),
    setCodexThreadSnapshot: (value) => (codexThreadSnapshot = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    setArchiveConfirmationSessionId: (value) => (archiveConfirmationSessionId = value),
    setArchivingSessionId: (value) => (archivingSessionId = value),
    setArchivingWorkspaceId: (value) => (archivingWorkspaceId = value),
    setRenamingSessionId: (value) => (renamingSessionId = value),
    setSessionLabelDraft: (value) => (sessionLabelDraft = value),
    clearSelectedSessionContext,
    activateWorkspace,
    refreshSessions,
    refreshCodexThreads,
    refreshCodexThread,
    isSessionRunning,
  });

  const agentSessionController = createAgentSessionController({
    api: {
      createCodexSession,
      createPiSession,
    },
    getDesktop: () => desktop,
    getWorkspaceSessionMap: () => workspaceSessionMap,
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setTimeline: (value) => (timeline = value),
    setUsageSnapshot: (value) => (usageSnapshot = value),
    setRetry: (prompt, reason) => {
      retryPrompt = prompt;
      retryReason = reason;
    },
    setLastSubmittedPrompt: (value) => (lastSubmittedPrompt = value),
    setPiTree: (value) => (piTree = value),
    setPiNavigationEntryId: (value) => (piNavigationEntryId = value),
    setCreateSessionWorkspaceId: (value) => (createSessionWorkspaceId = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    refreshCodexThreads,
    refreshPiTree,
    refreshExecutionProfile,
  });

  const workspaceController = createWorkspaceController({
    api: {
      addWorkspace,
      setWorkspaceTrust,
      removeWorkspace,
    },
    chooseDirectory: async () => {
      const selectedPath = await open({
        title: '选择工作区目录',
        directory: true,
        multiple: false,
        recursive: true,
        canCreateDirectories: false,
      });
      return typeof selectedPath === 'string' ? selectedPath : null;
    },
    getDesktop: () => desktop,
    getWorkspaces: () => workspaces,
    setWorkspaces: (value) => (workspaces = value),
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    getSelectedSessionId: () => selectedSessionId,
    getArchivingWorkspaceId: () => archivingWorkspaceId,
    getWorkspaceSessions,
    getWorkspaceSessionMap: () => workspaceSessionMap,
    getExpandedWorkspaceIds: () => expandedWorkspaceIds,
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    setExpandedWorkspaceIds: (value) => (expandedWorkspaceIds = value),
    setSelectedWorkspaceId: (value) => (selectedWorkspaceId = value),
    setCodexThreads: (value) => (codexThreads = value),
    setCodexThreadSnapshot: (value) => (codexThreadSnapshot = value),
    setPiTree: (value) => (piTree = value),
    setPiNavigationEntryId: (value) => (piNavigationEntryId = value),
    clearSelectedSessionContext,
    refreshSessions,
    refreshCodexThreads,
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    selectWorkspace,
  });

  const refreshController = createRefreshController({
    api: {
      listWorkspaces,
      probeAgents,
      listSessions,
      getSessionExecutionProfile,
    },
    getDesktop: () => desktop,
    getRestoringSelection: () => restoringSelection,
    getPersistedSelection: () => persistedSelection,
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    getSelectedSessionId: () => selectedSessionId,
    getExpandedWorkspaceIds: () => expandedWorkspaceIds,
    getSessionSearch: () => sessionSearch,
    getSessionFilter: () => sessionFilter,
    getWorkspaceSessions,
    getWorkspaceSessionMap: () => workspaceSessionMap,
    getSessionLoadGenerations: () => sessionLoadGenerations,
    getSessionsLoadingWorkspaceIds: () => sessionsLoadingWorkspaceIds,
    setWorkspaces: (value) => (workspaces = value),
    setDiagnostics: (value) => (diagnostics = value),
    setSelectedWorkspaceId: (value) => (selectedWorkspaceId = value),
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setExpandedWorkspaceIds: (value) => (expandedWorkspaceIds = value),
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    setSessionLoadGenerations: (value) => (sessionLoadGenerations = value),
    setSessionsLoadingWorkspaceIds: (value) => (sessionsLoadingWorkspaceIds = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    clearSelectedSessionContext,
    refreshTimeline,
    refreshCodexThreads,
    refreshCodexThread,
    refreshPiTree,
    setCodexThreads: (value) => (codexThreads = value),
    setCodexThreadSnapshot: (value) => (codexThreadSnapshot = value),
    setPiTree: (value) => (piTree = value),
    setExecutionProfile: (value) => (executionProfile = value),
    setPiNavigationEntryId: (value) => (piNavigationEntryId = value),
  });

  const messageController = createMessageController({
    api: {
      createCodexSession,
      sendCodexPrompt,
      sendPiPrompt,
      abortCodexTurn,
      abortPiTurn,
      steerPiPrompt,
      followUpPiPrompt,
    },
    getDesktop: () => desktop,
    getSelectedWorkspace: () => selectedWorkspace,
    getSelectedSession: () => selectedSession,
    getSelectedSessionArchiving: () => selectedSessionArchiving,
    getSessionRunning: () => sessionRunning,
    getComposerText: () => composerText,
    setComposerText: (value) => (composerText = value),
    getRetryPrompt: () => retryPrompt,
    setLastSubmittedPrompt: (value) => (lastSubmittedPrompt = value),
    setPromptInFlight: (value) => (promptInFlight = value),
    setSelectedSessionId: (value) => (selectedSessionId = value),
    getWorkspaceSessionMap: () => workspaceSessionMap,
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    getPendingApprovals: () => pendingApprovals,
    setPendingApprovals: (value) => (pendingApprovals = value),
    updateWorkspaceSessions,
    refreshTimeline,
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

  const approvalController = createApprovalController({
    api: { resolveCodexApproval },
    getDesktop: () => desktop,
    getPendingApprovals: () => pendingApprovals,
    setPendingApprovals: (value) => (pendingApprovals = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

  const piTreeController = createPiTreeController({
    api: { navigatePiSessionTree, getTimeline },
    getDesktop: () => desktop,
    getSelectedSession: () => selectedSession,
    getSelectedSessionId: () => selectedSessionId,
    getSessionRunning: () => sessionRunning,
    getPiTree: () => piTree,
    getPendingEntryId: () => piNavigationEntryId,
    setPendingEntryId: (value) => (piNavigationEntryId = value),
    setPiTree: (value) => (piTree = value),
    setTimeline: (value) => (timeline = value),
    setComposerText: (value) => (composerText = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

</script>

<svelte:head>
  <title>Aibo</title>
</svelte:head>

<div
  class="app-shell"
  data-ui-kit={$activeUiKitName}
  data-ui-theme={$activeTheme.id}
  data-color-scheme={$activeTheme.colorScheme}
  style={$activeThemeStyle}
>
  <WindowTitlebar onOpenSettings={() => (settingsOpen = true)} />

  <main class="workspace-grid">
    <WorkspaceSidebar
      workspaces={workspaceItems}
      sessionsByWorkspace={sessionItemsByWorkspace}
      selectedWorkspaceId={selectedWorkspaceId}
      expandedWorkspaceIds={expandedWorkspaceIds}
      selectedSessionId={selectedSessionId}
      sessionsLoadingWorkspaceIds={sessionsLoadingWorkspaceIds}
      busy={busy}
      threadBusy={threadBusy}
      archivingWorkspaceId={archivingWorkspaceId}
      archivingSessionId={archivingSessionId}
      sessionSearchOpen={sessionSearchOpen}
      sessionFilterOpen={sessionFilterOpen}
      bind:sessionSearch
      bind:sessionFilter
      createSessionWorkspaceId={createSessionWorkspaceId}
      renamingSessionId={renamingSessionId}
      bind:sessionLabelDraft
      onToggleSearch={() => (sessionSearchOpen = !sessionSearchOpen)}
      onToggleFilter={() => (sessionFilterOpen = !sessionFilterOpen)}
      onApplyFilters={() => void refreshExpandedSessions()}
      onChooseWorkspaceDirectory={() => void chooseWorkspaceDirectory()}
      onSelectWorkspace={selectWorkspace}
      onToggleSessionCreator={toggleSessionCreator}
      onToggleTrust={(workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void toggleTrust(workspace);
      }}
      onDeleteWorkspace={(workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void deleteWorkspace(workspace);
      }}
      onCreateCodex={(workspaceId) => {
        if (workspaceId !== selectedWorkspaceId) activateWorkspace(workspaceId);
        void createCodex();
      }}
      onCreatePi={(workspaceId) => {
        if (workspaceId !== selectedWorkspaceId) activateWorkspace(workspaceId);
        void createPi();
      }}
      onSelectSession={selectSession}
      onUnarchiveSession={(sessionId) => void unarchiveSession(sessionId)}
      onForkSession={(sessionId) => void forkSession(sessionId)}
      onRequestArchiveSession={requestArchiveSession}
      onCloseSession={(sessionId) => void closeSession(sessionId)}
      onSyncCodexThread={(sessionId) => void syncCodexThread(sessionId)}
      onBeginRenameSession={beginRenameSession}
      onSaveSessionRename={() => void saveSessionRename()}
      onCancelRenameSession={cancelRenameSession}
    />
    <TimelinePanel
      workspace={selectedWorkspace}
      session={selectedSession}
      codexThreadSnapshot={codexThreadSnapshot}
      timeline={timeline}
      timelineVisibleCount={timelineVisibleCount}
      usageValues={usageValues}
      retryPrompt={retryPrompt}
      retryReason={retryReason}
      approvals={selectedApprovals}
      agentActivityLabel={agentActivityLabel}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      busy={busy}
      bind:composerText
      onLoadOlderTimeline={loadOlderTimeline}
      onTimelineScroll={handleTimelineScroll}
      onRetry={() => void retryLastPrompt()}
      onResolveApproval={(requestId, decision) => {
        const approval = selectedApprovals.find((item) => item.requestId === requestId);
        if (approval) void resolveApproval(approval, decision);
      }}
      onSend={() => void sendPrompt()}
      onQueue={(mode) => void queuePiPrompt(mode)}
      onAbort={() => void abortPrompt()}
    />
    <Inspector
      workspace={selectedWorkspace}
      session={selectedSession}
      desktop={desktop}
      codexThreads={codexThreads}
      piTree={piTree}
      threadBusy={threadBusy}
      busy={busy}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      onSyncCodexThreads={() => void syncCodexThreads()}
      onRequestPiTreeNavigation={requestPiTreeNavigation}
      onRefreshPiTree={(sessionId) => void refreshPiTree(sessionId)}
      onRefresh={() => void refresh()}
    />
  </main>

  <SettingsPanel
    open={settingsOpen}
    diagnostics={diagnostics}
    desktop={desktop}
    workspaceCount={workspaces.length}
    sessionCount={sessions.length}
    busy={busy}
    uiKits={availableUiKits}
    activeUiKitName={$activeUiKitName}
    activeThemeId={$activeTheme.id}
    onSelectUiKit={setUiKit}
    onSelectTheme={setUiTheme}
    onRefresh={() => void refresh()}
    onClose={() => (settingsOpen = false)}
  />
  <AppOverlays
    {errorMessage}
    {notice}
    archiveConfirmationOpen={archiveConfirmationSessionId !== null}
    piNavigationOpen={piNavigationEntryId !== null}
    onConfirmArchive={() => void confirmArchiveSession()}
    onCancelArchive={() => (archiveConfirmationSessionId = null)}
    onConfirmPiNavigation={() => void confirmPiTreeNavigation()}
    onCancelPiNavigation={() => (piNavigationEntryId = null)}
  />
</div>
