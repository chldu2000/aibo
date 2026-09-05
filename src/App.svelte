<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import {
    AppOverlays,
    CommandPalette,
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
  import {
    AIBO_CODEX_COMMANDS,
    AIBO_PI_COMMANDS,
    parseAgentCommand,
  } from '$lib/app/agent-commands';
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
    getTurnChangeSet,
    listRestoreOperations,
    listTurnCheckpoints,
    getWorkspaceChanges,
    getTurnFileDiff,
    applyGitFileAction,
    applyGitHunkAction,
    listSessionAttachments,
    listTurnArtifacts,
    readArtifact,
    listProjectActions,
    listProjectActionRuns,
    saveProjectAction,
    deleteProjectAction,
    runProjectAction,
    registerSessionAttachments,
    removeSessionAttachment,
    validateSessionAttachments,
    restoreTurnChangeSet as restoreTurnChangeSetApi,
    getTimeline,
    getPiSessionTree,
    isTauri,
    listCodexThreads,
    listWorkspaces,
    searchWorkspacePaths,
    listPiCommands,
    compactPiSession,
    setPiThinkingLevel,
    setPiModel,
    reloadPiSession,
    listSessions,
    listenToAgentEvents,
    navigatePiSessionTree,
    probeAgents,
    inspectWorkspaceCapabilities,
    readCodexThread,
    renameSession as renameSessionApi,
    removeWorkspace,
    openWorkspaceLocation as openWorkspaceLocationApi,
    resolveCodexApproval,
    resolvePiApproval,
    sendCodexPrompt,
    sendPiPrompt,
    steerPiPrompt,
    followUpPiPrompt,
    abortPiTurn,
    clearPiQueue,
    setWorkspaceTrust,
    unarchiveSession as unarchiveSessionApi,
  } from './lib/api';
  import type {
    AgentQueueSnapshot,
    AgentCommand,
    AgentDiagnostic,
    AgentEvent,
    ApprovalDecision,
    ApprovalRequest,
    ContextAttachment,
    CheckpointFile,
    Artifact,
    ProjectAction,
    ProjectActionRun,
    CodexThreadSnapshot,
    CodexThreadSummary,
    Session,
    SessionExecutionProfile,
    TurnChangeSet,
    RestoreOperation,
    WorkspaceChanges,
    GitFileAction,
    TurnFileDiff,
    SessionFilter,
    InteractionMode,
    PiSessionTreeSnapshot,
    TimelineItem,
    Workspace,
    WorkspaceCapabilityInventory,
    WorkspacePathSuggestion,
  } from './lib/types';
  import type { SessionListItem, WorkspaceListItem } from './lib/components/app/view-types';
  import type { CommandPaletteCommand } from '$lib/components/app';
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
      capabilities: ['sdk-host', 'streaming', 'abort', 'session-tree', 'session-tree-navigation', 'session-snapshot', 'slash-commands', 'queue-management', 'read-only-tools', 'workspace-write-gateway', 'workspace-command-gateway', 'aibo-approval'],
      authState: 'delegated',
      message: 'Project-locked SDK host; workspace writes are mediated by Aibo Core; native authentication remains with Pi.',
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
  let workspaceCapabilities = $state<WorkspaceCapabilityInventory | null>(null);
  let workspaceSessionMap = $state<Record<string, Session[]>>({});
  let timeline = $state<TimelineItem[]>([]);
  let pendingApprovals = $state<ApprovalRequest[]>([]);
  let queueSnapshot = $state<AgentQueueSnapshot | null>(null);
  let codexThreads = $state<CodexThreadSummary[]>([]);
  let codexThreadSnapshot = $state<CodexThreadSnapshot | null>(null);
  let piTree = $state<PiSessionTreeSnapshot | null>(null);
  let executionProfile = $state<SessionExecutionProfile | null>(null);
  let turnChangeSet = $state<TurnChangeSet | null>(null);
  let checkpoints = $state<CheckpointFile[]>([]);
  let restoreOperations = $state<RestoreOperation[]>([]);
  let workspaceChanges = $state<WorkspaceChanges | null>(null);
  let turnFileDiff = $state<TurnFileDiff | null>(null);
  let attachments = $state<ContextAttachment[]>([]);
  let artifacts = $state<Artifact[]>([]);
  let projectActions = $state<ProjectAction[]>([]);
  let projectActionRuns = $state<ProjectActionRun[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let expandedWorkspaceIds = $state<string[]>([]);
  let selectedSessionId = $state<string | null>(null);
  let persistedSelection = $state<PersistedSelection | null>(null);
  let restoringSelection = $state(false);
  let sessionsLoadingWorkspaceIds = $state<string[]>([]);
  let sessionLoadGenerations = $state<Record<string, number>>({});
  let composerText = $state('');
  let workspacePathSuggestions = $state<WorkspacePathSuggestion[]>([]);
  let agentCommands = $state<AgentCommand[]>([]);
  let agentCommandsLoading = $state(false);
  let pathSearchGeneration = 0;
  let pathSearchTimer: ReturnType<typeof setTimeout> | undefined;

  const visibleAgentCommands = $derived.by(() => {
    if (!selectedSession) return [];
    const builtinCommands = selectedSession.agent === 'pi' ? AIBO_PI_COMMANDS : AIBO_CODEX_COMMANDS;
    const commands = [...builtinCommands, ...(selectedSession.agent === 'pi' ? agentCommands : [])];
    const seen = new Set<string>();
    return commands.filter((command) => {
      const name = command.name.toLocaleLowerCase();
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  });
  let commandSearchGeneration = 0;
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
  let createProfileMode = $state<InteractionMode>('ask');
  let renamingSessionId = $state<string | null>(null);
  let sessionLabelDraft = $state('');
  let timelineVisibleCount = $state(80);
  let usageSnapshot = $state<Record<string, unknown> | null>(null);
  let retryPrompt = $state<string | null>(null);
  let retryReason = $state<string | null>(null);
  let lastSubmittedPrompt = $state<string | null>(null);
  let settingsOpen = $state(false);
  let commandPaletteOpen = $state(false);
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
    const session = selectedSession;
    if (!desktop || !session || session.agent !== 'pi' || session.archived) {
      agentCommands = [];
      agentCommandsLoading = false;
      return;
    }
    agentCommandsLoading = true;
    const generation = ++commandSearchGeneration;
    void listPiCommands(session.id)
      .then((commands) => {
        if (generation === commandSearchGeneration && selectedSessionId === session.id) {
          agentCommands = commands;
          agentCommandsLoading = false;
        }
      })
      .catch(() => {
        if (generation === commandSearchGeneration && selectedSessionId === session.id) {
          agentCommands = [];
          agentCommandsLoading = false;
        }
      });
  });

  const commandPaletteCommands = $derived.by((): CommandPaletteCommand[] => [
    {
      id: 'new-session',
      label: '新建会话',
      description: selectedWorkspace ? `在 ${selectedWorkspace.label} 中选择 Agent` : '先选择一个工作区',
      shortcut: '⌘N',
      disabled: selectedWorkspaceId === null || busy,
      run: () => {
        if (selectedWorkspaceId) toggleSessionCreator(selectedWorkspaceId);
      },
    },
    {
      id: 'focus-composer',
      label: '聚焦消息输入框',
      description: selectedSession ? '开始输入消息' : '需要先选择会话',
      shortcut: '⌘I',
      disabled: selectedSession === null || busy,
      run: () => {
        document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
      },
    },
    {
      id: 'refresh',
      label: '刷新数据',
      description: '重新读取工作区、会话与当前线程',
      shortcut: '⌘R',
      disabled: busy,
      run: () => void refresh(),
    },
    {
      id: 'settings',
      label: '打开设置',
      description: '外观与 Agent 诊断',
      shortcut: '⌘,',
      run: () => (settingsOpen = true),
    },
    {
      id: 'archive-session',
      label: '归档当前会话',
      description: selectedSession?.label ?? '需要先选择会话',
      disabled: selectedSessionId === null || busy || selectedSessionArchiving,
      run: () => requestArchiveSession(),
    },
    {
      id: 'clear-pi-queue',
      label: '清空 Pi 队列',
      description: '移除当前 Pi 会话中尚未发送的消息',
      disabled: selectedSession?.agent !== 'pi'
        || queueSnapshot === null
        || (queueSnapshot.steering.length === 0 && queueSnapshot.followUp.length === 0)
        || busy,
      run: () => void clearPiPromptQueue(),
    },
  ]);

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const key = event.key.toLocaleLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && key === 'k') {
      event.preventDefault();
      commandPaletteOpen = !commandPaletteOpen;
      return;
    }
    if (modifier && key === 'n' && selectedWorkspaceId && !busy) {
      event.preventDefault();
      toggleSessionCreator(selectedWorkspaceId);
      return;
    }
    if (modifier && key === 'i' && selectedSession && !busy) {
      event.preventDefault();
      document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
      return;
    }
    if (modifier && key === 'r' && !busy) {
      event.preventDefault();
      void refresh();
      return;
    }
    if (modifier && event.key === ',') {
      event.preventDefault();
      settingsOpen = true;
      return;
    }
    if (event.key === 'Escape' && commandPaletteOpen) {
      event.preventDefault();
      commandPaletteOpen = false;
    }
  }

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
    queueSnapshot = null;
    timeline = [];
    codexThreadSnapshot = null;
    piTree = null;
    executionProfile = null;
    turnChangeSet = null;
    checkpoints = [];
    restoreOperations = [];
    workspaceChanges = null;
    turnFileDiff = null;
    attachments = [];
    artifacts = [];
    piNavigationEntryId = null;
    usageSnapshot = null;
    retryPrompt = null;
    retryReason = null;
    lastSubmittedPrompt = null;
    workspacePathSuggestions = [];
    agentCommands = [];
    agentCommandsLoading = false;
  }

  function handleComposerInput(value: string): void {
    const match = value.match(/(?:^|\s)@([^\s]*)$/);
    const workspaceId = selectedSession?.workspaceId ?? selectedWorkspaceId;
    if (!desktop || !workspaceId || !selectedSession || selectedSession.archived || !match) {
      if (pathSearchTimer) clearTimeout(pathSearchTimer);
      pathSearchTimer = undefined;
      workspacePathSuggestions = [];
      ++pathSearchGeneration;
      return;
    }
    const query = match[1] ?? '';
    const generation = ++pathSearchGeneration;
    if (pathSearchTimer) clearTimeout(pathSearchTimer);
    pathSearchTimer = setTimeout(() => {
      pathSearchTimer = undefined;
      void searchWorkspacePaths(workspaceId, query)
        .then((suggestions) => {
          if (generation === pathSearchGeneration && selectedSession?.workspaceId === workspaceId) {
            workspacePathSuggestions = suggestions;
          }
        })
        .catch(() => {
          if (generation === pathSearchGeneration) workspacePathSuggestions = [];
        });
    }, 120);
  }

  function selectComposerWorkspacePath(path: string): void {
    workspacePathSuggestions = [];
    void registerAttachmentPaths([path]);
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

  async function refreshExecutionProfile(sessionId: string) {
    await sessionContextController.refreshExecutionProfile(sessionId);
  }

  async function refreshAttachments(sessionId: string) {
    await sessionContextController.refreshAttachments(sessionId);
  }

  async function refreshTurnChangeSet(sessionId: string) {
    await sessionContextController.refreshTurnChangeSet(sessionId);
  }

  async function refreshArtifacts(sessionId: string) {
    await sessionContextController.refreshArtifacts(sessionId);
  }

  async function refreshWorkspaceChanges(workspaceId: string) {
    if (!desktop) {
      if (workspaceId === selectedWorkspaceId) workspaceChanges = null;
      return;
    }
    try {
      const changes = await getWorkspaceChanges(workspaceId);
      if (workspaceId === selectedWorkspaceId) workspaceChanges = changes;
    } catch (error) {
      if (workspaceId === selectedWorkspaceId) workspaceChanges = null;
      console.warn('unable to read workspace changes', error);
    }
  }

  async function registerAttachmentPaths(paths: string[]) {
    const session = selectedSession;
    if (!desktop || !session || session.archived || selectedSessionArchiving) return;
    try {
      if (paths.length === 0) return;
      const registered = await registerSessionAttachments(session.id, paths);
      const existing = new Set(attachments.map((item) => item.id));
      attachments = [...attachments, ...registered.filter((item) => !existing.has(item.id))];
      notice = registered.length > 0 ? `已添加 ${registered.length} 个上下文附件。` : '没有添加新的上下文附件。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function chooseSessionAttachments() {
    try {
      const selected = await open({
        title: '添加上下文文件',
        multiple: true,
        directory: false,
        recursive: true,
        canCreateDirectories: false,
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      await registerAttachmentPaths(paths);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function chooseSessionAttachmentDirectory() {
    try {
      const selected = await open({
        title: '添加上下文目录',
        multiple: false,
        directory: true,
        recursive: true,
        canCreateDirectories: false,
      });
      if (typeof selected === 'string') await registerAttachmentPaths([selected]);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function removeAttachment(attachmentId: string) {
    const session = selectedSession;
    if (!desktop || !session) return;
    try {
      await removeSessionAttachment(session.id, attachmentId);
      attachments = attachments.filter((item) => item.id !== attachmentId);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function showTurnFileDiff(sessionId: string, turnId: string, path: string) {
    try {
      turnFileDiff = await getTurnFileDiff(sessionId, turnId, path);
    } catch (error) {
      errorMessage = toErrorMessage(error);
      turnFileDiff = null;
    }
  }

  async function applyGitFileActionFromInspector(sessionId: string, turnId: string, path: string, action: GitFileAction) {
    if (action === 'revert' && !window.confirm(`确认撤销文件变更：${path}？此操作不可撤销。`)) return;
    try {
      const result = await applyGitFileAction(sessionId, path, action, turnId);
      if (result.applied) {
        notice = action === 'stage' ? '文件已暂存。' : action === 'unstage' ? '已取消暂存。' : '文件变更已撤销。';
        const session = findSession(sessionId);
        if (session) await refreshWorkspaceChanges(session.workspaceId);
      } else {
        errorMessage = result.message;
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function applyGitHunkActionFromInspector(
    sessionId: string,
    turnId: string,
    path: string,
    hunkIndex: number,
    action: GitFileAction,
  ) {
    if (action === 'revert' && !window.confirm(`确认撤销第 ${hunkIndex + 1} 个 hunk：${path}？此操作不可撤销。`)) return;
    try {
      const result = await applyGitHunkAction(sessionId, turnId, path, hunkIndex, action);
      if (result.applied) {
        notice = action === 'stage' ? 'hunk 已暂存。' : action === 'unstage' ? 'hunk 已取消暂存。' : 'hunk 变更已撤销。';
        const session = findSession(sessionId);
        if (session) await refreshWorkspaceChanges(session.workspaceId);
      } else {
        errorMessage = result.message;
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function restoreTurnChangeSet(sessionId: string, turnId: string) {
    if (!desktop) return;
    if (!window.confirm('确认恢复本轮 Agent 变更？只有当前文件未被后续修改时才会执行。')) return;
    try {
      const result = await restoreTurnChangeSetApi(sessionId, turnId);
      if (result.applied) {
        notice = result.restored.length > 0 ? `已恢复 ${result.restored.length} 个文件。` : '本轮没有可恢复的文件。';
        await refreshTimeline(sessionId);
        await refreshTurnChangeSet(sessionId);
      } else if (result.conflicts.length > 0) {
        notice = `恢复已阻止：${result.conflicts.length} 个文件在本轮后发生了变化。`;
      } else {
        notice = `恢复已阻止：${result.unsupported.join('、') || '当前变更无法安全恢复'}。`;
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
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
      setQueueSnapshot: (queue) => (queueSnapshot = queue),
      setTimeline: (nextTimeline) => (timeline = nextTimeline),
      refreshTimeline,
      setRetry: (prompt, reason) => {
        retryPrompt = prompt;
        retryReason = reason;
      },
      setNotice: (message) => (notice = message),
      refreshSessions,
      refreshTurnChangeSet,
      refreshWorkspaceChanges,
      refreshArtifacts,
    });
  }

  async function createWorkspace(path: string) {
    await workspaceController.createWorkspace(path);
  }

  async function chooseWorkspaceDirectory() {
    await workspaceController.chooseWorkspaceDirectory();
  }

  async function openWorkspaceLocation(workspaceId: string, target: 'finder' | 'terminal' | 'editor') {
    if (!desktop) return;
    try {
      await openWorkspaceLocationApi(workspaceId, target);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
  }

  async function createCodex() {
    await agentSessionController.createCodex(selectedWorkspace);
  }

  async function createPi() {
    await agentSessionController.createPi(selectedWorkspace);
  }

  async function executePiBuiltinCommand(input: string): Promise<boolean> {
    const command = parseAgentCommand(input);
    if (!command || selectedSession?.agent !== 'pi') return false;

    const session = selectedSession;
    const workspace = selectedWorkspace;
    const run = async (operation: () => Promise<void>): Promise<void> => {
      busy = true;
      errorMessage = null;
      try {
        await operation();
        composerText = '';
      } catch (error) {
        errorMessage = toErrorMessage(error);
      } finally {
        busy = false;
      }
    };

    switch (command.name) {
      case 'settings':
        if (command.args) {
          errorMessage = '/settings 不接受参数。';
          return true;
        }
        settingsOpen = true;
        composerText = '';
        return true;
      case 'new':
        if (command.args) {
          errorMessage = '/new 不接受参数。';
          return true;
        }
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        toggleSessionCreator(workspace.id);
        composerText = '';
        return true;
      case 'name':
        if (!command.args) {
          beginRenameSession(session.id);
          composerText = '';
          return true;
        }
        await run(async () => {
          const renamed = await renameSessionApi(session.id, command.args);
          updateWorkspaceSessions(session.workspaceId, (items) =>
            items.map((item) => (item.id === renamed.id ? renamed : item)),
          );
          notice = '会话名称已更新。';
        });
        return true;
      case 'trust':
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        if (command.args && !['on', 'off', 'true', 'false', 'trusted', 'untrusted'].includes(command.args.toLocaleLowerCase())) {
          errorMessage = '/trust 可选参数为 on 或 off。';
          return true;
        }
        if (command.args) {
          const shouldTrust = ['on', 'true', 'trusted'].includes(command.args.toLocaleLowerCase());
          if ((workspace.trust === 'trusted') !== shouldTrust) await run(() => toggleTrust(workspace));
          else composerText = '';
        } else {
          await run(() => toggleTrust(workspace));
        }
        return true;
      case 'tree':
        if (command.args) {
          errorMessage = '/tree 不接受参数。';
          return true;
        }
        await run(async () => {
          await refreshPiTree(session.id);
          notice = '会话树已刷新。';
        });
        return true;
      case 'session':
        if (command.args) {
          errorMessage = '/session 不接受参数。';
          return true;
        }
        notice = `${session.label} · ${session.externalSessionId ?? '尚未绑定 Pi 会话 ID'}`;
        composerText = '';
        return true;
      case 'resume':
        if (command.args) {
          errorMessage = '/resume 不接受参数。';
          return true;
        }
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        await run(async () => {
          activateWorkspace(workspace.id);
          await refreshSessions(workspace.id);
          notice = '会话列表已刷新。';
        });
        return true;
      case 'compact':
        await run(async () => {
          await compactPiSession(session.id, command.args);
          timeline = await getTimeline(session.id);
          notice = 'Pi 上下文压缩已完成。';
        });
        return true;
      case 'thinking':
        await run(async () => {
          const result = await setPiThinkingLevel(session.id, command.args || undefined);
          const level = typeof result.level === 'string' ? result.level : null;
          const available = Array.isArray(result.availableLevels)
            ? result.availableLevels.filter((item): item is string => typeof item === 'string')
            : [];
          notice = command.args
            ? `思考级别已设置为 ${level ?? command.args}。`
            : `当前思考级别：${level ?? '未知'}${available.length > 0 ? `（可选：${available.join('、')}）` : ''}`;
        });
        return true;
      case 'model':
        await run(async () => {
          const result = await setPiModel(session.id, command.args || undefined);
          if (command.args) {
            const provider = typeof result.provider === 'string' ? result.provider : '';
            const id = typeof result.id === 'string' ? result.id : command.args;
            notice = `当前模型已切换为 ${provider ? `${provider}/` : ''}${id}。`;
          } else {
            const current = result.current && typeof result.current === 'object'
              ? result.current as { provider?: unknown; id?: unknown }
              : null;
            const models = Array.isArray(result.models)
              ? result.models.filter((item): item is { provider?: unknown; id?: unknown } => Boolean(item && typeof item === 'object'))
              : [];
            const currentLabel = current && typeof current.provider === 'string' && typeof current.id === 'string'
              ? `${current.provider}/${current.id}`
              : '未选择';
            notice = `当前模型：${currentLabel}${models.length > 0 ? ` · 可用 ${models.length} 个` : ''}`;
          }
        });
        return true;
      case 'reload':
        if (command.args) {
          errorMessage = '/reload 不接受参数。';
          return true;
        }
        await run(async () => {
          const result = await reloadPiSession(session.id);
          if (Array.isArray(result.commands)) {
            agentCommands = result.commands.filter((item): item is AgentCommand => Boolean(item && typeof item === 'object' && typeof item.name === 'string'));
          }
          notice = 'Pi 会话资源已重新加载。';
        });
        return true;
      default:
        return false;
    }
  }

  async function executeCodexBuiltinCommand(input: string): Promise<boolean> {
    const command = parseAgentCommand(input);
    if (!command || selectedSession?.agent !== 'codex') return false;

    const session = selectedSession;
    const workspace = selectedWorkspace;
    const run = async (operation: () => Promise<void>): Promise<void> => {
      busy = true;
      errorMessage = null;
      try {
        await operation();
        composerText = '';
      } catch (error) {
        errorMessage = toErrorMessage(error);
      } finally {
        busy = false;
      }
    };

    switch (command.name) {
      case 'settings':
        if (command.args) {
          errorMessage = '/settings 不接受参数。';
          return true;
        }
        settingsOpen = true;
        composerText = '';
        return true;
      case 'new':
        if (command.args) {
          errorMessage = '/new 不接受参数。';
          return true;
        }
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        toggleSessionCreator(workspace.id);
        composerText = '';
        return true;
      case 'name':
        if (!command.args) {
          beginRenameSession(session.id);
          composerText = '';
          return true;
        }
        await run(async () => {
          const renamed = await renameSessionApi(session.id, command.args);
          updateWorkspaceSessions(session.workspaceId, (items) =>
            items.map((item) => (item.id === renamed.id ? renamed : item)),
          );
          notice = '会话名称已更新。';
        });
        return true;
      case 'trust':
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        if (command.args && !['on', 'off', 'true', 'false', 'trusted', 'untrusted'].includes(command.args.toLocaleLowerCase())) {
          errorMessage = '/trust 可选参数为 on 或 off。';
          return true;
        }
        if (command.args) {
          const shouldTrust = ['on', 'true', 'trusted'].includes(command.args.toLocaleLowerCase());
          if ((workspace.trust === 'trusted') !== shouldTrust) await run(() => toggleTrust(workspace));
          else composerText = '';
        } else {
          await run(() => toggleTrust(workspace));
        }
        return true;
      case 'tree':
        if (command.args) {
          errorMessage = '/tree 不接受参数。';
          return true;
        }
        await run(async () => {
          await refreshCodexThread(session.id);
          notice = 'Codex 线程已刷新。';
        });
        return true;
      case 'session':
        if (command.args) {
          errorMessage = '/session 不接受参数。';
          return true;
        }
        notice = `${session.label} · ${session.externalSessionId ?? '尚未绑定 Codex 线程 ID'}`;
        composerText = '';
        return true;
      case 'resume':
        if (command.args) {
          errorMessage = '/resume 不接受参数。';
          return true;
        }
        if (!workspace) {
          errorMessage = '请先选择一个工作区。';
          return true;
        }
        await run(async () => {
          activateWorkspace(workspace.id);
          await refreshSessions(workspace.id);
          await refreshCodexThread(session.id);
          notice = 'Codex 线程已恢复。';
        });
        return true;
      case 'fork':
        if (command.args) {
          errorMessage = '/fork 不接受参数。';
          return true;
        }
        await run(() => forkSession(session.id));
        return true;
      case 'archive':
        if (command.args) {
          errorMessage = '/archive 不接受参数。';
          return true;
        }
        requestArchiveSession(session.id);
        composerText = '';
        return true;
      default:
        return false;
    }
  }

  async function sendPrompt() {
    if (selectedSession?.agent === 'codex' && await executeCodexBuiltinCommand(composerText)) return;
    if (selectedSession?.agent === 'pi' && await executePiBuiltinCommand(composerText)) return;
    await messageController.sendPrompt();
  }

  async function retryLastPrompt() {
    await messageController.retryLastPrompt();
  }

  async function abortPrompt() {
    await messageController.abortPrompt();
  }

  async function queuePiPrompt(mode: 'steer' | 'followUp') {
    if (selectedSession?.agent === 'pi' && await executePiBuiltinCommand(composerText)) return;
    await messageController.queuePiPrompt(mode);
  }

  async function clearPiPromptQueue() {
    if (!selectedSession || selectedSession.agent !== 'pi') return;
    try {
      await clearPiQueue(selectedSession.id);
      queueSnapshot = null;
      timeline = await getTimeline(selectedSession.id);
      notice = '已清空 Pi 待处理消息。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    }
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
    if (id !== selectedWorkspaceId) projectActionRuns = [];
    navigationController.activateWorkspace(id);
  }

  function selectWorkspace(id: string) {
    if (id !== selectedWorkspaceId) projectActionRuns = [];
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
      getTurnChangeSet,
      listRestoreOperations,
      listTurnCheckpoints,
      listSessionAttachments,
      listTurnArtifacts,
      listProjectActions,
      listProjectActionRuns,
      inspectWorkspaceCapabilities,
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
    setTurnChangeSet: (value) => (turnChangeSet = value),
    setCheckpoints: (value) => (checkpoints = value),
    setRestoreOperations: (value) => (restoreOperations = value),
    setAttachments: (value) => (attachments = value),
    setArtifacts: (value) => (artifacts = value),
    setProjectActions: (value) => (projectActions = value),
    setProjectActionRuns: (value) => (projectActionRuns = value),
    setWorkspaceCapabilities: (value) => (workspaceCapabilities = value),
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
    setQueueSnapshot: (value) => (queueSnapshot = value),
    setRetry: (prompt, reason) => {
      retryPrompt = prompt;
      retryReason = reason;
    },
    setLastSubmittedPrompt: (value) => (lastSubmittedPrompt = value),
    setExecutionProfile: (value) => (executionProfile = value),
    setCheckpoints: (value) => (checkpoints = value),
    setRestoreOperations: (value) => (restoreOperations = value),
    setTurnFileDiff: (value) => (turnFileDiff = value),
    setAttachments: (value) => (attachments = value),
    setArtifacts: (value) => (artifacts = value),
    setProjectActions: (value) => (projectActions = value),
    setProjectActionRuns: (value) => (projectActionRuns = value),
    setWorkspaceCapabilities: (value) => (workspaceCapabilities = value),
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
    refreshTurnChangeSet,
    refreshAttachments: (sessionId) => sessionContextController.refreshAttachments(sessionId),
    refreshArtifacts: (sessionId) => sessionContextController.refreshArtifacts(sessionId),
    refreshProjectActions: (workspaceId) => sessionContextController.refreshProjectActions(workspaceId),
    refreshWorkspaceCapabilities: (workspaceId) => sessionContextController.refreshWorkspaceCapabilities(workspaceId),
    refreshWorkspaceChanges,
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
    setQueueSnapshot: (value) => (queueSnapshot = value),
    setCheckpoints: (value) => (checkpoints = value),
    setRetry: (prompt, reason) => {
      retryPrompt = prompt;
      retryReason = reason;
    },
    setLastSubmittedPrompt: (value) => (lastSubmittedPrompt = value),
    setPiTree: (value) => (piTree = value),
    setAttachments: (value) => (attachments = value),
    setPiNavigationEntryId: (value) => (piNavigationEntryId = value),
    setCreateSessionWorkspaceId: (value) => (createSessionWorkspaceId = value),
    getCreateProfileMode: () => createProfileMode,
    setCreateProfileMode: (value) => (createProfileMode = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    refreshCodexThreads,
    refreshPiTree,
    refreshTurnChangeSet,
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
    setWorkspaceCapabilities: (value) => (workspaceCapabilities = value),
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
      inspectWorkspaceCapabilities,
      getSessionExecutionProfile,
      getTurnChangeSet,
      getWorkspaceChanges,
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
    refreshAttachments: (sessionId) => sessionContextController.refreshAttachments(sessionId),
    refreshArtifacts: (sessionId) => sessionContextController.refreshArtifacts(sessionId),
    refreshProjectActions: (workspaceId) => sessionContextController.refreshProjectActions(workspaceId),
    refreshWorkspaceCapabilities: (workspaceId) => sessionContextController.refreshWorkspaceCapabilities(workspaceId),
    refreshWorkspaceChanges,
    setCodexThreads: (value) => (codexThreads = value),
    setCodexThreadSnapshot: (value) => (codexThreadSnapshot = value),
    setPiTree: (value) => (piTree = value),
    setExecutionProfile: (value) => (executionProfile = value),
    setTurnChangeSet: (value) => (turnChangeSet = value),
    setWorkspaceChanges: (value) => (workspaceChanges = value),
    setAttachments: (value) => (attachments = value),
    setArtifacts: (value) => (artifacts = value),
    setProjectActions: (value) => (projectActions = value),
    setProjectActionRuns: (value) => (projectActionRuns = value),
    setWorkspaceCapabilities: (value) => (workspaceCapabilities = value),
    setRestoreOperations: (value) => (restoreOperations = value),
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
      validateSessionAttachments,
    },
    getDesktop: () => desktop,
    getSelectedWorkspace: () => selectedWorkspace,
    getSelectedSession: () => selectedSession,
    getSelectedSessionArchiving: () => selectedSessionArchiving,
    getSessionRunning: () => sessionRunning,
    getComposerText: () => composerText,
    setComposerText: (value) => (composerText = value),
    getAttachments: () => attachments,
    setAttachments: (value) => (attachments = value),
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
    refreshAttachments,
    refreshTurnChangeSet,
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

  const approvalController = createApprovalController({
    api: { resolveCodexApproval, resolvePiApproval },
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

<svelte:window onkeydown={handleGlobalKeydown} />

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
      createProfileMode={createProfileMode}
      renamingSessionId={renamingSessionId}
      bind:sessionLabelDraft
      onToggleSearch={() => (sessionSearchOpen = !sessionSearchOpen)}
      onToggleFilter={() => (sessionFilterOpen = !sessionFilterOpen)}
      onApplyFilters={() => void refreshExpandedSessions()}
      onChooseWorkspaceDirectory={() => void chooseWorkspaceDirectory()}
      onSelectWorkspace={selectWorkspace}
      onToggleSessionCreator={toggleSessionCreator}
      onSetCreateProfileMode={(mode) => (createProfileMode = mode)}
      onToggleTrust={(workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void toggleTrust(workspace);
      }}
      onDeleteWorkspace={(workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void deleteWorkspace(workspace);
      }}
      onOpenWorkspaceLocation={(workspaceId, target) => void openWorkspaceLocation(workspaceId, target)}
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
      queueSnapshot={queueSnapshot}
      agentActivityLabel={agentActivityLabel}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      busy={busy}
      attachments={attachments}
      workspacePathSuggestions={workspacePathSuggestions}
      agentCommands={visibleAgentCommands}
      agentCommandsLoading={agentCommandsLoading}
      bind:composerText
      onComposerInput={handleComposerInput}
      onSelectWorkspacePath={selectComposerWorkspacePath}
      onAddAttachments={() => void chooseSessionAttachments()}
      onAddDirectory={() => void chooseSessionAttachmentDirectory()}
      onRemoveAttachment={(attachmentId) => void removeAttachment(attachmentId)}
      onLoadOlderTimeline={loadOlderTimeline}
      onTimelineScroll={handleTimelineScroll}
      onRetry={() => void retryLastPrompt()}
      onResolveApproval={(requestId, decision) => {
        const approval = selectedApprovals.find((item) => item.requestId === requestId);
        if (approval) void resolveApproval(approval, decision);
      }}
      onSend={() => void sendPrompt()}
      onQueue={(mode) => void queuePiPrompt(mode)}
      onClearQueue={() => void clearPiPromptQueue()}
      onAbort={() => void abortPrompt()}
    />
    <Inspector
      workspace={selectedWorkspace}
      session={selectedSession}
      desktop={desktop}
      {diagnostics}
      workspaceCapabilities={workspaceCapabilities}
      codexThreads={codexThreads}
      piTree={piTree}
      executionProfile={executionProfile}
      attachments={attachments}
      artifacts={artifacts}
      projectActions={projectActions}
      projectActionRuns={projectActionRuns}
      turnChangeSet={turnChangeSet}
      checkpoints={checkpoints}
      restoreOperations={restoreOperations}
      workspaceChanges={workspaceChanges}
      turnFileDiff={turnFileDiff}
      threadBusy={threadBusy}
      busy={busy}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      onSyncCodexThreads={() => void syncCodexThreads()}
      onRequestPiTreeNavigation={requestPiTreeNavigation}
      onRefreshPiTree={(sessionId) => void refreshPiTree(sessionId)}
      onRestoreTurnChangeSet={restoreTurnChangeSet}
      onShowTurnFileDiff={showTurnFileDiff}
      onApplyGitFileAction={applyGitFileActionFromInspector}
      onApplyGitHunkAction={applyGitHunkActionFromInspector}
      onReadArtifact={readArtifact}
      onSaveProjectAction={async (input) => {
        try {
          const saved = await saveProjectAction(input);
          projectActions = projectActions.some((item) => item.id === saved.id)
            ? projectActions.map((item) => (item.id === saved.id ? saved : item))
            : [...projectActions, saved];
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }
      }}
      onDeleteProjectAction={async (actionId) => {
        try {
          if (selectedWorkspaceId) {
            await deleteProjectAction(selectedWorkspaceId, actionId);
            projectActions = projectActions.filter((item) => item.id !== actionId);
          }
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }
      }}
      onRunProjectAction={async (actionId) => {
        try {
          if (!selectedWorkspaceId) return;
          const result = await runProjectAction(selectedWorkspaceId, actionId, selectedSessionId);
          projectActionRuns = [result, ...projectActionRuns.filter((item) => item.id !== result.id)].slice(0, 20);
          if (selectedSessionId) await refreshArtifacts(selectedSessionId);
          notice = result.status === 'completed' ? '工程动作已完成。' : `工程动作${result.status === 'timed_out' ? '超时' : '失败'}。`;
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }
      }}
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
  <CommandPalette
    open={commandPaletteOpen}
    commands={commandPaletteCommands}
    onClose={() => (commandPaletteOpen = false)}
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
