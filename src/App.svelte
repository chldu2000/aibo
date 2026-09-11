<script lang="ts">
  import { readWorkbenchDrafts, writeWorkbenchDrafts, emptyGitPanelState } from '$lib/app/workbench-drafts';
  const draftStorage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) };
  let workbenchDrafts = $state(readWorkbenchDrafts(draftStorage, presentationWindowId()));
  $effect(() => { writeWorkbenchDrafts(draftStorage, presentationWindowId(), workbenchDrafts); });
  import { WorkbenchPresentation, Badge, Button, Card, CardHeader, CardTitle, CardContent } from '$lib/ui-kit';
  const loadInstalledWorkbench = () => import('$lib/workbench/InstalledWorkbench.svelte');
  import { listSemanticContributions, cancelSemanticOpen, openSemanticContribution, actSemanticContribution, releaseSemanticContribution } from '$lib/api';
  import type { InstalledContribution, InstalledScope } from '$lib/presentation/installed-controller';
  const installedPort = { cancelOpen: cancelSemanticOpen, open: openSemanticContribution, act: actSemanticContribution, release: releaseSemanticContribution };
  let installedContributions = $state<InstalledContribution[]>([]);
  let installedTool = $state<InstalledContribution | null>(null);
  const installedScope = $derived<InstalledScope>(installedTool?.scope === 'application' ? {kind:'application'} : installedTool?.scope === 'session' ? {kind:'session',id:selectedSessionId ?? ''} : {kind:'workspace',id:selectedWorkspaceId ?? ''});
  function contributionAvailable(item: InstalledContribution) {
    return desktop && item.available
      && (item.scope !== 'workspace' && item.scope !== undefined || !!selectedWorkspaceId)
      && (item.scope !== 'session' || !!selectedSessionId)
      && (item.visibility !== 'workspaceSelected' || !!selectedWorkspaceId)
      && (item.visibility !== 'sessionSelected' || !!selectedSessionId);
  }
  let catalogBusy = false;
  async function refreshInstalledTools() {
    if (!desktop || catalogBusy) return;
    catalogBusy = true;
    try {
      installedContributions = await listSemanticContributions();
      if (installedTool && !installedContributions.some(item => item.installationId === installedTool?.installationId && item.contributionId === installedTool?.contributionId && item.available)) installedTool = null;
    } catch { installedContributions = []; installedTool = null; }
    finally { catalogBusy = false; }
  }
  onMount(() => { void refreshInstalledTools(); const timer = setInterval(() => { void refreshInstalledTools(); }, 2000); return () => clearInterval(timer); });
  $effect(() => { pluginInstallations; untrack(() => { void refreshInstalledTools(); }); });

  const presentationState = createViewStateStore({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }, presentationWindowId());
  import { onDestroy, onMount, untrack } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import {
    AppOverlays,
    CommandPalette,
    DiagnosticsPanel,
    Inspector,
    PiSessionTreeOverlay,
    SettingsPanel,
    TimelinePanel,
    WindowTitlebar,
    ExecutionHistoryPanel,
    SessionHistoryPanel,
    CapabilityHistoryPanel,
    WorkspaceFileDiffPreview,
    WorkspaceGitPanel,
    WorkspaceSidebar,
    PluginWorkspacePanel,
    toSessionListItemsByWorkspace,
    toUsageValues,
    toWorkspaceListItems,
    toolLabel,
  } from '$lib/components/app';
  import type { SidePanelView } from '$lib/components/app';
  import {
    readPersistedSelection as readSelectionFromStorage,
    writePersistedSelection as writeSelectionToStorage,
  } from '$lib/app/selection-storage';
  import { handleAgentEvent as processAgentEvent } from '$lib/app/agent-event-handler';
  import { createExecutionHistoryController, emptyExecutionHistory } from '$lib/app/execution-history-controller';
  import { createSessionHistoryController, emptySessionHistory } from '$lib/app/session-history-controller';
  import { createCapabilityHistoryController, emptyCapabilityHistory } from '$lib/app/capability-history-controller';
  import { listCapabilityHistoryScopes, readCapabilityHistory } from '$lib/api';
  import { listWorkspaceWriteRuns, cancelWorkspaceWrite, readSessionHistory } from '$lib/api';
  import { createProjectTaskController, observeProjectTaskHistory } from '$lib/app/project-task-controller';
  import { createApprovalController } from '$lib/app/approval-controller';
  import { toErrorMessage } from '$lib/app/error-utils';
  import { createSessionLifecycleController } from '$lib/app/session-lifecycle-controller';
  import { createAgentSessionController } from '$lib/app/agent-session-controller';
  import { createSessionContextController } from '$lib/app/session-context-controller';
  import { createRefreshController } from '$lib/app/refresh-controller';
  import { createModelConfigurationService, modelConfigurationState } from '$lib/app/model-configuration';
  import type { ModelConfigurationChange } from '$lib/app/model-configuration';
  import { createLegacyModelConfiguration } from '$lib/app/compatibility/legacy-model-configuration';
  import { listCodexThreads, readCodexThread, forkCodexThread, listPiCommands, listCodexSkills, getPiSessionTree, navigatePiSessionTree } from '$lib/compatibility/agent-api';
  import { legacyAgentOperations } from '$lib/compatibility/agent-api';
  import { legacyCapability } from '$lib/app/compatibility/legacy-capability';
  import { createAgentFacade } from '$lib/app/agent-facade';
  import { createViewStateStore } from '$lib/app/view-state-storage';
  import { createMessageController } from '$lib/app/message-controller';
  import { createNavigationController } from '$lib/app/navigation-controller';
  import { createPiTreeController } from '$lib/app/pi-tree-controller';
  import { createWorkspaceController } from '$lib/app/workspace-controller';
  import {
    AIBO_CODEX_COMMANDS,
    AIBO_PI_COMMANDS,
    parseAgentCommand,
  } from '$lib/app/agent-commands';
  import { upsertSession, workspaceIdsForRefresh } from '$lib/app/session-transitions';
  import type { PersistedSelection } from '$lib/app/selection-storage';
  import {
    readComposerDrafts,
    writeComposerDrafts,
  } from '$lib/app/composer-draft-storage';
  import type { ComposerDrafts } from '$lib/app/composer-draft-storage';
  import { isSessionRunning } from '$lib/app/session-state';
  import { dispatchBuiltinCommand } from '$lib/app/compatibility/command-dispatch';
  import { sessionAgentKind } from '$lib/app/agent-kind';
  import {
    addWorkspace,
    archiveSession as archiveSessionApi,
    getSessionExecutionProfile,
    getTurnChangeSet,
    listRestoreOperations,
    listTurnCheckpoints,
    getWorkspaceChanges,
    getWorkspaceFileDiff,
    applyWorkspaceGitFileAction,
    applyWorkspaceGitAction as applyWorkspaceGitActionApi,
    commitWorkspaceChanges,
    listWorkspaceGitBranches,
    checkoutWorkspaceGitBranch,
    createWorkspaceGitBranch,
    listWorkspaceGitHistory,
    listWorkspaceGitCommitFiles,
    getWorkspaceGitCommitFileDiff,
    getWorkspaceGitRemoteStatus,
    syncWorkspaceGit,
    listWorkspaceGitStashes,
    applyWorkspaceGitStash,
    stashWorkspaceGit,
    getTurnFileDiff,
    applyGitFileAction,
    applyGitHunkAction,
    listSessionAttachments,
    listTurnArtifacts,
    readArtifact,
    listProjectActions,
    listProjectActionRuns,
    cancelProjectAction,
    saveProjectAction,
    deleteProjectAction,
    runProjectAction,
    registerSessionAttachments,
    removeSessionAttachment,
    validateSessionAttachments,
    restoreTurnChangeSet as restoreTurnChangeSetApi,
    getTimeline,
    isTauri,
    listWorkspaces,
    searchWorkspacePaths,
    getComposerDraft,
    saveComposerDraft,
    getSessionModels,
    updateSessionExecutionProfile,
    listSessions as listAllSessions,
    listPluginInstallations,
    installAgentPlugin,
    setAgentPluginEnabled,
    uninstallAgentPlugin,
    createAgentSession,
    sendAgentPrompt,
    cancelAgentTurn,
    resumeAgentSession,
    closeAgentSession,
    getPluginViews,
    invokePluginViewAction,
    invokeAgentCapability,
    listenToAgentEvents,
    probeAgents,
    inspectWorkspaceCapabilities,
    renameSession as renameSessionApi,
    removeWorkspace,
    openWorkspaceLocation as openWorkspaceLocationApi,
    resolveAgentApproval,
    resolveAgentUserInput,
    setWorkspaceTrust,
    presentationWindowId,
    toggleWindowMaximize,
    minimizeWindow,
    closeWindow,
    unarchiveSession as unarchiveSessionApi,
  } from './lib/api';
  import type { PluginInstallation } from './lib/api';
  import type { UiPluginViewSnapshot, UiPluginViewVersion } from '$lib/ui-kit';
  import type {
    AgentQueueSnapshot,
    AgentCommand,
    AgentDiagnostic,
    AgentEvent,
    ApprovalDecision,
    ApprovalRequest,
    UserInputRequest,
    ContextAttachment,
    ExecutionProfile,
    CheckpointFile,
    Artifact,
    ProjectAction,
    ProjectActionRun,
    CodexThreadSnapshot,
    CodexThreadSummary,
    Session,
    SessionModelCatalog,
    SessionAccessMode,
    SessionExecutionProfile,
    AgentGoal,
    TurnChangeSet,
    RestoreOperation,
    WorkspaceChanges,
    WorkspaceFileDiff,
    GitWorkspaceAction,
    GitBranch,
    GitCommit,
    GitCommitFileList,
    GitRemoteStatus,
    GitSyncAction,
    GitStashEntry,
    GitFileAction,
    TurnFileDiff,
    SessionFilter,
    InteractionMode,
    PiSessionTreeSnapshot,
    PiTreeNavigationMode,
    PiTreeNavigationOptions,
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
    ColumnSplitter,
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
      return readSelectionFromStorage(window.localStorage, presentationWindowId());
    } catch {
      return null;
    }
  }

  function writePersistedSelection(selection: PersistedSelection | null) {
    if (typeof window === 'undefined') return;
    try {
      writeSelectionToStorage(window.localStorage, selection, presentationWindowId());
    } catch {
      // The WebView may reject localStorage access altogether.
    }
  }

  function readPersistedComposerDrafts(): ComposerDrafts {
    if (typeof window === 'undefined') return {};
    try {
      return readComposerDrafts(window.localStorage);
    } catch {
      return {};
    }
  }

  function writePersistedComposerDrafts(drafts: ComposerDrafts) {
    if (typeof window === 'undefined') return;
    try {
      writeComposerDrafts(window.localStorage, drafts);
    } catch {
      // Drafts are best-effort when the WebView denies localStorage access.
    }
  }

  let workspaces = $state<Workspace[]>([]);
  let diagnostics = $state<AgentDiagnostic[]>([]);
  let workspaceCapabilities = $state<WorkspaceCapabilityInventory | null>(null);
  let workspaceSessionMap = $state<Record<string, Session[]>>({});
  let timeline = $state<TimelineItem[]>([]);
  let pendingApprovals = $state<ApprovalRequest[]>([]);
  let pendingUserInputs = $state<UserInputRequest[]>([]);
  let queueSnapshot = $state<AgentQueueSnapshot | null>(null);
  let codexThreads = $state<CodexThreadSummary[]>([]);
  let codexThreadSnapshot = $state<CodexThreadSnapshot | null>(null);
  let piTree = $state<PiSessionTreeSnapshot | null>(null);
  let executionProfile = $state<SessionExecutionProfile | null>(null);
  let sessionModelOverride = $state<string | null>(null);
  let sessionModelCatalog = $state<SessionModelCatalog | null>(null);
  let sessionModelCatalogLoading = $state(false);
  let codexGoal = $state<AgentGoal | null>(null);
  let sessionModelRequestGeneration = 0;
  let turnChangeSet = $state<TurnChangeSet | null>(null);
  let checkpoints = $state<CheckpointFile[]>([]);
  let restoreOperations = $state<RestoreOperation[]>([]);
  let workspaceChanges = $state<WorkspaceChanges | null>(null);
  let workspaceChangesLoading = $state(false);
  let workspaceChangesError = $state<string | null>(null);
  let workspaceGitBusyPath = $state<string | null>(null);
  let workspaceChangesRequestGeneration = 0;
  let workspaceChangesBackgroundRefreshing = false;
  let workspaceFileDiff = $state<WorkspaceFileDiff | null>(null);
  let workspaceFileDiffLoading = $state(false);
  let workspaceFileDiffError = $state<string | null>(null);
  let workspaceFileDiffPath = $state<string | null>(null);
  let workspaceFileDiffStaged = $state(false);
  let workspaceFileDiffContextLabel = $state<string | null>(null);
  let workspaceFileDiffRequestGeneration = 0;
  let workspaceGitCommitBusy = $state(false);
  let workspaceGitBranches = $state<GitBranch[]>([]);
  let workspaceGitHistory = $state<GitCommit[]>([]);
  let workspaceGitMetadataLoading = $state(false);
  let workspaceGitMetadataError = $state<string | null>(null);
  let workspaceGitMetadataRequestGeneration = 0;
  let workspaceGitMetadataBackgroundRefreshing = false;
  let workspaceGitCommitFiles = $state<GitCommitFileList | null>(null);
  let workspaceGitCommitFilesLoading = $state(false);
  let workspaceGitCommitFilesRequestGeneration = 0;
  let workspaceGitRemoteStatus = $state<GitRemoteStatus | null>(null);
  let workspaceGitStashes = $state<GitStashEntry[]>([]);
  let workspaceGitSyncBusy = $state(false);
  let workspaceGitReviewBusy = $state(false);
  let turnFileDiff = $state<TurnFileDiff | null>(null);
  let attachments = $state<ContextAttachment[]>([]);
  let artifacts = $state<Artifact[]>([]);
  let projectActions = $state<ProjectAction[]>([]);
  let projectActionRuns = $state<ProjectActionRun[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let expandedWorkspaceIds = $state<string[]>([]);
  let selectedSessionId = $state<string | null>(null);
  let persistedSelection = $state<PersistedSelection | null>(null);
  let composerDrafts = $state<ComposerDrafts>({});
  let draftHydratingSessionId = $state<string | null>(null);
  let draftHydrationGeneration = 0;
  // This is intentionally not Svelte state: changing it marks a user edit
  // during an in-flight desktop draft read without restarting hydration.
  let draftHydrationEditGeneration = 0;
  let draftWriteQueue: Promise<void> = Promise.resolve();
  const pendingDraftWrites = new Map<string, { text: string; sendFailed: boolean }>();
  const draftWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let restoringSelection = $state(false);
  let sessionsLoadingWorkspaceIds = $state<string[]>([]);
  let composerText = $state('');
  let workspacePathSuggestions = $state<WorkspacePathSuggestion[]>([]);
  let agentCommands = $state<AgentCommand[]>([]);
  let agentCommandsLoading = $state(false);
  let pathSearchGeneration = 0;
  let pathSearchTimer: ReturnType<typeof setTimeout> | undefined;

  const workspaceGitOperationBusy = $derived(
    workspaceGitBusyPath !== null || workspaceGitCommitBusy || workspaceGitSyncBusy,
  );

  function resetWorkspaceGitView(): void {
    ++workspaceChangesRequestGeneration;
    workspaceChanges = null;
    workspaceChangesLoading = false;
    workspaceChangesError = null;
    closeWorkspaceFileDiff();
    ++workspaceGitMetadataRequestGeneration;
    workspaceGitBranches = [];
    workspaceGitHistory = [];
    workspaceGitRemoteStatus = null;
    workspaceGitStashes = [];
    workspaceGitMetadataLoading = false;
    workspaceGitMetadataError = null;
    closeWorkspaceCommitFiles();
  }

  function setSelectedWorkspace(value: string | null): void {
    if (value === selectedWorkspaceId) return;
    resetWorkspaceGitView();
    selectedWorkspaceId = value;
    if (value && desktop) {
      void refreshWorkspaceChanges(value);
      if (sidePanelOpen && sidePanelView === 'git') {
        void refreshWorkspaceGitMetadata(value);
      }
    }
  }

  const visibleAgentCommands = $derived.by(() => {
    if (!selectedSession) return [];
    const selectedKind = sessionAgentKind(selectedSession);
    const builtinCommands = selectedKind === 'pi' ? AIBO_PI_COMMANDS : selectedKind === 'codex' ? AIBO_CODEX_COMMANDS : [];
    const commands = [...builtinCommands, ...(selectedKind !== 'codex' ? agentCommands : [])];
    const seen = new Set<string>();
    return commands.filter((command) => {
      if (command.enabled === false) return false;
      if (command.agent && command.agent !== 'both' && command.agent !== selectedKind) return false;
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
  let piNavigationMode = $state<PiTreeNavigationMode>('none');
  let piNavigationCustomInstructions = $state('');
  let piTreeOpen = $state(false);
  let piNavigationStatus = $state<string | null>(null);
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
  const listSessions: typeof listAllSessions = listAllSessions;
  let pluginsOpen = $state(false);
  let historyOpen = $state(false);
  let historyWorkspaceId = $state<string | null>(null);
  let executionHistory = $state(emptyExecutionHistory());
  let historyTrigger: HTMLElement | null = null;
  const executionHistoryController = createExecutionHistoryController({
    readTasks: (id, before) => listProjectActionRuns(id, 21, before), readWrites: (id, before) => listWorkspaceWriteRuns(id, 21, before),
    cancelTask: cancelProjectAction, cancelWrite: cancelWorkspaceWrite,
    publish: value => { executionHistory = value; },
  });
  $effect(() => {
    if (!historyOpen || !desktop || !historyWorkspaceId) return;
    executionHistoryController.open(historyWorkspaceId, presentationWindowId());
    return () => executionHistoryController.close();
  });
  function openExecutionHistory(): void {
    capabilityHistoryOpen = false;
    sessionHistoryOpen = false;
    historyTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pluginsOpen = false; settingsOpen = false; diagnosticsOpen = false; commandPaletteOpen = false;
    historyWorkspaceId = selectedWorkspaceId ?? workspaces[0]?.id ?? null;
    historyOpen = true;
  }
  function closeExecutionHistory(): void { historyOpen = false;
    const trigger = historyTrigger?.isConnected ? historyTrigger : document.querySelector<HTMLElement>('[data-host-navigation="history"]');
    trigger?.focus(); }

  let sessionHistoryOpen = $state(false);
  let sessionHistoryWorkspaceId = $state<string | null>(null);
  let sessionHistory = $state(emptySessionHistory());
  let sessionHistoryTrigger: HTMLElement | null = null;
  const sessionHistoryController = createSessionHistoryController({
    list: id => listAllSessions(id, { statusFilter: 'all' }), read: readSessionHistory,
    publish: value => { sessionHistory = value; },
  });
  $effect(() => {
    if (!sessionHistoryOpen || !desktop || !sessionHistoryWorkspaceId) return;
    void sessionHistoryController.open(sessionHistoryWorkspaceId, untrack(() => selectedSessionId));
    return () => sessionHistoryController.close();
  });
  function openSessionHistory(): void {
    capabilityHistoryOpen = false;
    sessionHistoryTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    historyOpen = false; pluginsOpen = false; settingsOpen = false; diagnosticsOpen = false; commandPaletteOpen = false;
    sessionHistoryWorkspaceId = selectedWorkspaceId ?? workspaces[0]?.id ?? null;
    sessionHistoryOpen = true;
  }
  function closeSessionHistory(): void {
    sessionHistoryOpen = false;
    const trigger = sessionHistoryTrigger?.isConnected ? sessionHistoryTrigger : document.querySelector<HTMLElement>('[data-host-navigation="session-history"]');
    trigger?.focus();
  }

  let capabilityHistoryOpen = $state(false);
  let capabilityHistory = $state(emptyCapabilityHistory());
  const capabilityHistoryController = createCapabilityHistoryController({list:listCapabilityHistoryScopes,read:readCapabilityHistory,publish:value=>{capabilityHistory=value;}});
  $effect(()=>{
    if(!capabilityHistoryOpen||!desktop)return;
    void capabilityHistoryController.open();
    return ()=>capabilityHistoryController.close();
  });
  function openCapabilityHistory():void { historyOpen=false;sessionHistoryOpen=false;pluginsOpen=false;capabilityHistoryOpen=true; }
  function backFromCapabilityHistory():void { capabilityHistoryOpen=false;historyOpen=true; }

  let pluginInstallations = $state<PluginInstallation[]>([]);
  const pluginSessions = $derived((workspaceSessionMap[selectedWorkspaceId ?? ''] ?? []).filter(session => Boolean(session.pluginInstallationId)));
  let pluginViews = $state<UiPluginViewSnapshot[]>([]);
  let pluginViewSessionId = $state<string | null>(null);
  let pluginPackagePath = $state('');
  let pluginBusy = $state(false);
  let pluginError = $state('');
  const pluginSessionId = $derived(pluginSessions.some(session => session.id === selectedSessionId) ? selectedSessionId : null);
  const pluginSession = $derived(pluginSessions.find((session) => session.id === pluginSessionId) ?? null);

  async function pluginOperation(operation: () => Promise<void>): Promise<void> {
    if (pluginBusy || !desktop) return;
    pluginBusy = true;
    pluginError = '';
    try { await operation(); }
    catch (error) { pluginError = toErrorMessage(error); }
    finally { pluginBusy = false; }
  }

  // Host controls survive renderer generations, but never a workspace/session change.
  function hostGuard(_id: string, callback: (...args: any[]) => any) {
    const workspaceId = selectedWorkspaceId;
    const sessionId = selectedSessionId;
    return (...args: any[]) => {
      if (workspaceId !== selectedWorkspaceId || sessionId !== selectedSessionId) return;
      return callback(...args);
    };
  }

  function openPluginPanel(): void {
    capabilityHistoryOpen = false;
    sessionHistoryOpen = false;
    historyOpen = false;
    settingsOpen = false;
    diagnosticsOpen = false;
    commandPaletteOpen = false;
    installedTool = null;
    pluginsOpen = true;
    void pluginOperation(async () => { pluginInstallations = await listPluginInstallations(); });
  }

  async function installPlugin(): Promise<void> {
    await pluginOperation(async () => {
      await installAgentPlugin(pluginPackagePath.trim());
      pluginInstallations = await listPluginInstallations();
      pluginPackagePath = '';
    });
  }

  async function enablePlugin(id: string, enabled: boolean): Promise<void> {
    await pluginOperation(async () => {
      await setAgentPluginEnabled(id, enabled);
      pluginInstallations = await listPluginInstallations();
    });
  }

  async function uninstallPlugin(id: string): Promise<void> {
    await pluginOperation(async () => {
      await uninstallAgentPlugin(id);
      pluginInstallations = await listPluginInstallations();
      if (selectedWorkspaceId) await refreshSessions(selectedWorkspaceId);
    });
  }

  async function createPluginSession(installationId: string, agentId: string): Promise<void> {
    const workspaceId = selectedWorkspaceId;
    if (!workspaceId) { pluginError = '请先选择工作区。'; return; }
    await pluginOperation(async () => {
      const session = await createAgentSession(workspaceId, agentId, installationId);
      workspaceSessionMap = upsertSession(workspaceSessionMap, session);
      if (selectedWorkspaceId === workspaceId) navigationController.selectSession(session.id);
    });
  }

  async function sendPluginPrompt(): Promise<void> {
    if (!pluginSessionId) return;
    await pluginOperation(() => messageController.sendPrompt());
  }

  function pluginSessionOperation(operation: (sessionId: string) => Promise<void>): void {
    const id = pluginSessionId;
    if (id) void pluginOperation(async () => {
      await operation(id);
      const session = findSession(id);
      if (session) await refreshSessions(session.workspaceId);
    });
  }

  async function invokePluginAction(viewId: string, actionId: string, input: Record<string, unknown>, version: UiPluginViewVersion): Promise<void> {
    const sessionId = pluginSessionId;
    if (!sessionId) return;
    await pluginOperation(async () => {
      await invokePluginViewAction(sessionId, viewId, actionId, input, version);
      if (pluginSessionId === sessionId) pluginViews = await getPluginViews(sessionId);
    });
  }

  $effect(() => {
    const workspaceId = selectedWorkspaceId;
    const sessionId = pluginSessionId;
    if (!pluginsOpen || !desktop || !workspaceId) return;
    let disposed = false;
    let polling = false;
    async function poll(): Promise<void> {
      if (polling || disposed) return;
      polling = true;
      try {
        const [sessions, views] = await Promise.allSettled([
          refreshSessions(workspaceId!, false),
          sessionId ? getPluginViews(sessionId) : Promise.resolve([]),
        ]);
        if (disposed) return;
        pluginViews = views.status === 'fulfilled' ? views.value : [];
        pluginViewSessionId = sessionId;
        const failed = [sessions, views].find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') pluginError = toErrorMessage(failed.reason);
      } catch (error) {
        if (!disposed) pluginError = toErrorMessage(error);
      } finally { polling = false; }
    }
    untrack(() => { void poll(); });
    const timer = setInterval(() => { void poll(); }, 750);
    return () => { disposed = true; clearInterval(timer); };
  });
  let diagnosticsOpen = $state(false);
  let sidePanelOpen = $state(true);
  let sidePanelView = $state<SidePanelView>('git');
  const inspectorOpen = $derived(sidePanelOpen);
  let workspaceSidebarWidth = $state(260);
  let inspectorWidth = $state(320);
  let workspaceGridElement = $state<HTMLElement | null>(null);
  type ColumnResizeTarget = 'workspace' | 'inspector';
  type ColumnResizeState = {
    target: ColumnResizeTarget;
    startX: number;
    startWidth: number;
  };
  let columnResizeState: ColumnResizeState | null = null;
  const workspaceColumnMin = 180;
  const timelineColumnMin = 320;
  const inspectorColumnMin = 220;
  const splitterTrackWidth = 14;
  let commandPaletteOpen = $state(false);
  let promptInFlight = $state(false);
  let activeAgentSessionIds = $state<string[]>([]);
  let agentActivityOverrides = $state<Record<string, string | undefined>>({});
  let agentActivityUpdatedAt = $state<Record<string, number | undefined>>({});
  let activityNow = $state(Date.now());
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  function openSettingsPanel(): void {
    diagnosticsOpen = false;
    settingsOpen = true;
  }

  function openDiagnosticsPanel(): void {
    settingsOpen = false;
    diagnosticsOpen = true;
  }

  function toggleMaximizeWindow(): void {
    void toggleWindowMaximize().catch((error) => {
      console.warn('unable to toggle window maximize', error);
    });
  }

  function minimizeAppWindow(): void {
    void minimizeWindow().catch((error) => {
      console.warn('unable to minimize window', error);
    });
  }

  function closeAppWindow(): void {
    void closeWindow().catch((error) => {
      console.warn('unable to close window', error);
    });
  }

  function clampColumnWidth(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function maxColumnWidth(target: ColumnResizeTarget): number {
    const totalWidth = workspaceGridElement?.clientWidth ?? 0;
    const splitterWidth = splitterTrackWidth * (sidePanelOpen ? 2 : 1);
    const otherColumnWidth = target === 'workspace' ? inspectorWidth : workspaceSidebarWidth;
    return totalWidth - splitterWidth - otherColumnWidth - timelineColumnMin;
  }

  function setColumnWidth(target: ColumnResizeTarget, value: number): void {
    if (target === 'workspace') {
      workspaceSidebarWidth = clampColumnWidth(value, workspaceColumnMin, maxColumnWidth(target));
    } else {
      inspectorWidth = clampColumnWidth(value, inspectorColumnMin, maxColumnWidth(target));
    }
  }

  function beginColumnResize(target: ColumnResizeTarget, event: PointerEvent): void {
    if (event.button !== 0 || !workspaceGridElement) return;
    event.preventDefault();
    columnResizeState = {
      target,
      startX: event.clientX,
      startWidth: target === 'workspace' ? workspaceSidebarWidth : inspectorWidth,
    };
    window.addEventListener('pointermove', handleColumnResize);
    window.addEventListener('pointerup', endColumnResize);
    window.addEventListener('pointercancel', endColumnResize);
  }

  function handleColumnResize(event: PointerEvent): void {
    const state = columnResizeState;
    if (!state) return;
    const delta = event.clientX - state.startX;
    const width = state.target === 'workspace'
      ? state.startWidth + delta
      : state.startWidth - delta;
    setColumnWidth(state.target, width);
  }

  function endColumnResize(): void {
    columnResizeState = null;
    window.removeEventListener('pointermove', handleColumnResize);
    window.removeEventListener('pointerup', endColumnResize);
    window.removeEventListener('pointercancel', endColumnResize);
  }

  function handleSplitterKeydown(target: ColumnResizeTarget, event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const delta = target === 'workspace' ? direction : -direction;
    const currentWidth = target === 'workspace' ? workspaceSidebarWidth : inspectorWidth;
    setColumnWidth(target, currentWidth + delta * 16);
  }

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const sessions = $derived(workspaceSessionMap[selectedWorkspaceId ?? ''] ?? []);

  const workspaceItems = $derived<WorkspaceListItem[]>(toWorkspaceListItems(workspaces));

  const sessionItemsByWorkspace = $derived(
    toSessionListItemsByWorkspace(workspaceSessionMap),
  );

  const usageValues = $derived(toUsageValues(usageSnapshot));
  const composerDraftFailed = $derived(
    selectedSessionId ? composerDrafts[selectedSessionId]?.sendFailed === true : false,
  );

  const selectedSession = $derived.by(() => {
    if (!selectedSessionId) return null;
    for (const workspaceSessions of Object.values(workspaceSessionMap)) {
      const session = workspaceSessions.find((item) => item.id === selectedSessionId);
      if (session) return session;
    }
    return null;
  });
  const selectedSessionAgent = $derived(sessionAgentKind(selectedSession));
  const selectedSessionArchived = $derived(selectedSession?.archived ?? false);

  $effect(() => {
    if (desktop && !restoringSelection) {
      writePersistedSelection(
        selectedSession
          ? { workspaceId: selectedSession.workspaceId, sessionId: selectedSession.id }
          : null,
      );
    }
  });

  function normalizeCodexGoal(value: Record<string, unknown>): AgentGoal | null {
    const candidate = value.goal && typeof value.goal === 'object'
      ? value.goal as Record<string, unknown>
      : value;
    const objective = typeof candidate.objective === 'string' ? candidate.objective.trim() : '';
    if (!objective) return null;
    const rawStatus = typeof candidate.status === 'string' ? candidate.status : 'unknown';
    const status: AgentGoal['status'] = ['active', 'paused', 'completed', 'cleared'].includes(rawStatus)
      ? rawStatus as AgentGoal['status']
      : 'unknown';
    return {
      objective,
      status,
      tokenBudget: typeof candidate.tokenBudget === 'number' ? candidate.tokenBudget : null,
      tokensUsed: typeof candidate.tokensUsed === 'number' ? candidate.tokensUsed : null,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    };
  }

  $effect(() => {
    const id = selectedSessionId;
    const agent = selectedSessionAgent;
    const archived = selectedSessionArchived;
    if (!desktop || !selectedSession?.capabilities.includes('goal.manage') || archived || !id) {
      codexGoal = null;
      return;
    }
    codexGoal = null;
    void agentFacade.invoke(selectedSession!, 'goal.manage', { action: 'get' })
      .then((value) => {
        if (selectedSessionId === id) codexGoal = normalizeCodexGoal(value);
      })
      .catch(() => {
        if (selectedSessionId === id) codexGoal = null;
      });
  });

  $effect(() => {
    const id = selectedSessionId;
    const enabled = desktop;
    const draft = id ? untrack(() => composerDrafts[id]?.text ?? '') : '';
    const generation = ++draftHydrationGeneration;
    const editGeneration = draftHydrationEditGeneration;
    draftHydratingSessionId = enabled && id ? id : null;
    untrack(() => {
      composerText = draft;
      if (enabled && id && draft) notice = '已恢复当前会话草稿。';
    });
    if (!enabled || !id) return;
    void getComposerDraft(id)
      .then((remoteDraft) => {
        if (generation !== draftHydrationGeneration || selectedSessionId !== id) return;
        if (!remoteDraft) return;
        // The user may start editing while SQLite is loading. Never let an
        // older remote value replace that newer input.
        if (draftHydrationEditGeneration !== editGeneration) return;
        const localDraft = composerDrafts[id];
        if (localDraft?.updatedAt && localDraft.updatedAt > remoteDraft.updatedAt) return;
        const next = {
          ...composerDrafts,
          [id]: {
            ...composerDrafts[id],
            ...remoteDraft,
            sendFailed: remoteDraft.sendFailed === true,
          },
        };
        composerDrafts = next;
        composerText = remoteDraft.text;
        if (remoteDraft.sendFailed) notice = '上次发送未完成，已恢复草稿。';
      })
      .catch(() => {
        // localStorage remains the offline/preview fallback; a stale desktop
        // draft must not prevent the user from continuing to edit.
      })
      .finally(() => {
        if (generation === draftHydrationGeneration && selectedSessionId === id) {
          draftHydratingSessionId = null;
        }
      });
  });

  function flushComposerDraftWrite(sessionId: string): void {
    const timer = draftWriteTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    draftWriteTimers.delete(sessionId);
    const pending = pendingDraftWrites.get(sessionId);
    if (!pending) return;
    pendingDraftWrites.delete(sessionId);
    draftWriteQueue = draftWriteQueue
      .then(() => saveComposerDraft(sessionId, pending.text, pending.sendFailed).then(() => undefined))
      .catch(() => undefined);
  }

  function scheduleComposerDraftWrite(
    sessionId: string,
    text: string,
    sendFailed: boolean,
    immediate = false,
  ): void {
    pendingDraftWrites.set(sessionId, { text, sendFailed });
    const previous = draftWriteTimers.get(sessionId);
    if (previous) clearTimeout(previous);
    if (immediate) {
      flushComposerDraftWrite(sessionId);
      return;
    }
    const timer = setTimeout(() => {
      draftWriteTimers.delete(sessionId);
      flushComposerDraftWrite(sessionId);
    }, 250);
    draftWriteTimers.set(sessionId, timer);
  }

  $effect(() => {
    const id = selectedSessionId;
    const text = composerText;
    if (!desktop || !id) return;
    // Depend on the boolean projection, not the map replaced by this effect.
    // Replacing the map must not schedule another identical draft write.
    const sendFailed = composerDraftFailed;
    if (draftHydratingSessionId === id) return;
    untrack(() => {
      const next = { ...composerDrafts };
      if (text.trim()) {
        next[id] = {
          text,
          updatedAt: new Date().toISOString(),
          sendFailed,
        };
      } else {
        delete next[id];
      }
      composerDrafts = next;
      writePersistedComposerDrafts(next);
      // Empty text means a successful send cleared the draft; persist that
      // deletion immediately so a quick app restart cannot resurrect it.
      scheduleComposerDraftWrite(id, text, sendFailed, !text.trim());
    });
  });

  const sessionRunning = $derived(isSessionRunning(selectedSession));
  const selectedSessionArchiving = $derived(
    selectedSessionId !== null && selectedSessionId === archivingSessionId,
  );
  const selectedApprovals = $derived(
    pendingApprovals.filter((approval) => approval.sessionId === selectedSessionId),
  );
  const selectedUserInputRequests = $derived(
    pendingUserInputs.filter((request) => request.sessionId === selectedSessionId),
  );
  const streamingTimelineItem = $derived.by(() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item?.status === 'streaming') return item;
    }
    return null;
  });
  const activeAgentSession = $derived(
    selectedSession ? activeAgentSessionIds.includes(selectedSession.id) : false,
  );
  const selectedActivityAgeSeconds = $derived.by(() => {
    if (!selectedSession || !activeAgentSession) return null;
    const updatedAt = agentActivityUpdatedAt[selectedSession.id];
    if (!updatedAt) return null;
    return Math.max(0, Math.floor((activityNow - updatedAt) / 1000));
  });
  function withActivityAge(label: string): string {
    const age = selectedActivityAgeSeconds;
    if (age === null || age < 15) return label;
    if (age < 60) return `${label} · 已等待 ${age} 秒（最近活动）`;
    const minutes = Math.floor(age / 60);
    const seconds = age % 60;
    return `${label} · 已等待 ${minutes} 分 ${seconds} 秒（最近活动）`;
  }
  const agentActivityLabel = $derived.by(() => {
    if (!selectedSession) return null;
    if (selectedSessionArchiving) return '正在归档会话…';
    if (
      !promptInFlight &&
      ['failed', 'interrupted', 'closed'].includes(selectedSession.state)
    ) {
      return null;
    }
    // Keep the activity indicator visible while a tool or assistant message
    // is still streaming, even if the durable session state has already
    // transitioned to idle and the timeline refresh is still in flight.
    if (
      !sessionRunning &&
      !promptInFlight &&
      !activeAgentSession &&
      !streamingTimelineItem
    ) return null;
    if (selectedSession.state === 'waiting_approval' || selectedApprovals.length > 0) {
      return withActivityAge('等待你的确认…');
    }
    if (selectedSession.state === 'waiting_user' || selectedUserInputRequests.length > 0) {
      return withActivityAge('等待你的输入…');
    }
    if (selectedSession.state === 'compacting') return withActivityAge('正在压缩上下文…');
    const agentLabel = sessionAgentKind(selectedSession) === 'pi' ? 'Pi' : 'Codex';
    const activityOverride = agentActivityOverrides[selectedSession.id];
    if (activityOverride) return withActivityAge(activityOverride);
    if (streamingTimelineItem?.role === 'tool') {
      return withActivityAge(`${agentLabel} 正在执行 ${toolLabel(streamingTimelineItem)}…`);
    }
    if (streamingTimelineItem?.role === 'assistant') {
      return withActivityAge(`${agentLabel} 正在生成回复…`);
    }
    const latest = timeline.at(-1);
    if (latest?.role === 'tool' && latest.status === 'failed') {
      return withActivityAge(`${agentLabel} 正在处理工具错误…`);
    }
    if (latest?.role === 'tool' && latest.status === 'completed') {
      return withActivityAge(`${agentLabel} 工具执行完成，等待模型继续响应…`);
    }
    if (promptInFlight && !sessionRunning && !activeAgentSession) {
      return withActivityAge(`${agentLabel} 正在启动请求…`);
    }
    return withActivityAge(`${agentLabel} 等待模型响应（可能正在思考）…`);
  });
  async function loadSessionCommands(session: Session): Promise<AgentCommand[]> {
    const capability = session.capabilities.includes('command.list') ? 'command.list' : session.capabilities.includes('skill.list') ? 'skill.list' : null;
    if (!capability) return [];
    const result = await agentFacade.invoke(session, capability);
    return (Array.isArray(result.commands) ? result.commands : Array.isArray(result.skills) ? result.skills : []) as AgentCommand[];
  }

  const contextCompacting = $derived(agentActivityLabel?.includes('压缩上下文') ?? false);

  $effect(() => {
    const session = selectedSession;
    if (!desktop || !session || session.archived) {
      agentCommands = [];
      agentCommandsLoading = false;
      return;
    }
    agentCommandsLoading = true;
    const generation = ++commandSearchGeneration;
    const loadCommands = loadSessionCommands(session);
    void loadCommands
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
    ...installedContributions.map(item => ({ id: `installed:${item.installationId}:${item.contributionId}`, label: item.title, description: item.issue ?? '已安装的插件视图', disabled: !contributionAvailable(item),
      run: () => { installedTool = item; pluginsOpen = false; commandPaletteOpen = false; } })),
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
      description: '外观与主题设置',
      shortcut: '⌘,',
      run: openSettingsPanel,
    },
    {
      id: 'diagnostics',
      label: '打开 Agent 诊断',
      description: '查看 Agent 连接与运行环境',
      run: openDiagnosticsPanel,
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
      label: '清空待处理队列',
      description: '移除当前会话中尚未发送的消息',
      disabled: !selectedSession?.capabilities.includes('queue.manage')
        || queueSnapshot === null
        || (queueSnapshot.steering.length === 0 && queueSnapshot.followUp.length === 0)
        || busy,
      run: () => void clearPiPromptQueue(),
    },
  ]);

  function handleGlobalKeydown(event: KeyboardEvent): void {
    const key = event.key.toLocaleLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (capabilityHistoryOpen && !settingsOpen && !diagnosticsOpen) {
      if (key === 'escape') {event.preventDefault();backFromCapabilityHistory();}
      return;
    }
    if (sessionHistoryOpen && !settingsOpen && !diagnosticsOpen) {
      if (key === 'escape') { event.preventDefault(); closeSessionHistory(); }
      return;
    }
    if (historyOpen && !settingsOpen && !diagnosticsOpen) {
      if (key === 'escape') { event.preventDefault(); closeExecutionHistory(); }
      return;
    }
    if (pluginsOpen && !settingsOpen && !diagnosticsOpen) {
      if (key === 'escape') { event.preventDefault(); pluginsOpen = false; }
      return;
    }
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
      openSettingsPanel();
      return;
    }
    if (event.key === 'Escape') {
      if (commandPaletteOpen) {
        event.preventDefault();
        commandPaletteOpen = false;
      } else if (settingsOpen) {
        event.preventDefault();
        settingsOpen = false;
      } else if (diagnosticsOpen) {
        event.preventDefault();
        diagnosticsOpen = false;
      }
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

  // Re-evaluate the activity copy while a provider is quiet. This is not a
  // heartbeat and does not change session state; it only makes a long gap
  // explainable instead of looking like a frozen or idle composer.
  $effect(() => {
    const timer = setInterval(() => {
      activityNow = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  onMount(() => {
    composerDrafts = readPersistedComposerDrafts();
    let stopListening: (() => void) | undefined;
    let disposed = false;
    let lastGitMetadataPollAt = 0;

    const refreshVisibleGitPanel = (forceMetadata = false): void => {
      if (
        !desktop
        || !sidePanelOpen
        || sidePanelView !== 'git'
        || !selectedWorkspaceId
        || document.visibilityState !== 'visible'
      ) return;
      const workspaceId = selectedWorkspaceId;
      void refreshWorkspaceChanges(workspaceId, true);
      const now = Date.now();
      if (forceMetadata || now - lastGitMetadataPollAt >= 5000) {
        lastGitMetadataPollAt = now;
        void refreshWorkspaceGitMetadata(workspaceId, true);
      }
    };
    const handleWindowFocus = () => refreshVisibleGitPanel(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshVisibleGitPanel(true);
    };
    const gitPollingTimer = window.setInterval(() => refreshVisibleGitPanel(), 1250);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void (async () => {
      const runningDesktop = isTauri();
      if (!runningDesktop) {
        workspaces = previewWorkspaces;
        diagnostics = previewDiagnostics;
        setSelectedWorkspace(previewWorkspaces[0]?.id ?? null);
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
      window.clearInterval(gitPollingTimer);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  onDestroy(endColumnResize);

  async function refresh() {
    await refreshController.refresh();
  }

  async function refreshSessions(workspaceId: string, hydrate = true) {
    await refreshController.refreshSessions(workspaceId, hydrate);
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

  function setAgentActivity(sessionId: string, active: boolean, label?: string): void {
    agentActivityOverrides = { ...agentActivityOverrides, [sessionId]: active ? label : undefined };
    if (active) {
      agentActivityUpdatedAt = { ...agentActivityUpdatedAt, [sessionId]: Date.now() };
      if (!activeAgentSessionIds.includes(sessionId)) {
        activeAgentSessionIds = [...activeAgentSessionIds, sessionId];
      }
      return;
    }
    activeAgentSessionIds = activeAgentSessionIds.filter((id) => id !== sessionId);
    const nextActivityTimes = { ...agentActivityUpdatedAt };
    delete nextActivityTimes[sessionId];
    agentActivityUpdatedAt = nextActivityTimes;
  }

  function markSessionIdle(session: Session): void {
    updateWorkspaceSessions(session.workspaceId, (items) =>
      items.map((item) => (item.id === session.id ? { ...item, state: 'idle' } : item)),
    );
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
    sessionModelOverride = null;
    sessionModelCatalog = null;
    sessionModelCatalogLoading = false;
    ++sessionModelRequestGeneration;
    turnChangeSet = null;
    checkpoints = [];
    restoreOperations = [];
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
    draftHydrationEditGeneration += 1;
    if (selectedSessionId && composerDrafts[selectedSessionId]?.sendFailed) {
      const next = {
        ...composerDrafts,
        [selectedSessionId]: { ...composerDrafts[selectedSessionId], sendFailed: false },
      };
      composerDrafts = next;
      writePersistedComposerDrafts(next);
    }
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

  async function refreshWorkspaceChanges(workspaceId: string, background = false) {
    if (background && (workspaceChangesLoading || workspaceChangesBackgroundRefreshing)) return;
    const generation = ++workspaceChangesRequestGeneration;
    if (!desktop) {
      if (workspaceId === selectedWorkspaceId) {
        workspaceChanges = null;
        workspaceChangesError = null;
        workspaceChangesLoading = false;
      }
      return;
    }
    if (background) workspaceChangesBackgroundRefreshing = true;
    if (workspaceId === selectedWorkspaceId) {
      if (workspaceChanges?.workspaceId !== workspaceId) workspaceChanges = null;
      if (!background) workspaceChangesLoading = true;
      workspaceChangesError = null;
    }
    try {
      const changes = await getWorkspaceChanges(workspaceId);
      if (generation === workspaceChangesRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceChanges = changes;
      }
    } catch (error) {
      if (generation === workspaceChangesRequestGeneration && workspaceId === selectedWorkspaceId) {
        if (!background) workspaceChanges = null;
        if (!background) workspaceChangesError = toErrorMessage(error);
      }
      console.warn('unable to read workspace changes', error);
    } finally {
      if (generation === workspaceChangesRequestGeneration && workspaceId === selectedWorkspaceId) {
        if (!background) workspaceChangesLoading = false;
      }
      if (background) workspaceChangesBackgroundRefreshing = false;
    }
  }

  async function openWorkspaceFileDiff(
    workspaceId: string,
    path: string,
    staged: boolean,
  ): Promise<void> {
    const generation = ++workspaceFileDiffRequestGeneration;
    workspaceFileDiffPath = path;
    workspaceFileDiffStaged = staged;
    workspaceFileDiffContextLabel = null;
    workspaceFileDiff = null;
    workspaceFileDiffLoading = true;
    workspaceFileDiffError = null;
    try {
      const diff = await getWorkspaceFileDiff(workspaceId, path, staged);
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceFileDiff = diff;
      }
    } catch (error) {
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceFileDiff = null;
        workspaceFileDiffError = toErrorMessage(error);
      }
    } finally {
      if (generation === workspaceFileDiffRequestGeneration) workspaceFileDiffLoading = false;
    }
  }

  function closeWorkspaceFileDiff(): void {
    ++workspaceFileDiffRequestGeneration;
    workspaceFileDiff = null;
    workspaceFileDiffPath = null;
    workspaceFileDiffStaged = false;
    workspaceFileDiffContextLabel = null;
    workspaceFileDiffError = null;
    workspaceFileDiffLoading = false;
  }

  async function refreshWorkspaceGitMetadata(workspaceId: string, background = false): Promise<void> {
    if (background && (workspaceGitMetadataLoading || workspaceGitMetadataBackgroundRefreshing)) return;
    if (background) workspaceGitMetadataBackgroundRefreshing = true;
    const generation = ++workspaceGitMetadataRequestGeneration;
    if (!background) workspaceGitMetadataLoading = true;
    workspaceGitMetadataError = null;
    try {
      const [branches, history, remoteStatus, stashes] = await Promise.all([
        listWorkspaceGitBranches(workspaceId),
        listWorkspaceGitHistory(workspaceId),
        getWorkspaceGitRemoteStatus(workspaceId),
        listWorkspaceGitStashes(workspaceId),
      ]);
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceGitBranches = branches;
        workspaceGitHistory = history;
        workspaceGitRemoteStatus = remoteStatus;
        workspaceGitStashes = stashes;
      }
    } catch (error) {
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId) {
        if (!background) workspaceGitMetadataError = toErrorMessage(error);
      }
    } finally {
      if (generation === workspaceGitMetadataRequestGeneration && !background) workspaceGitMetadataLoading = false;
      if (background) workspaceGitMetadataBackgroundRefreshing = false;
    }
  }

  async function checkoutWorkspaceBranch(workspaceId: string, branch: string): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await checkoutWorkspaceGitBranch(workspaceId, branch);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = `已切换到 ${branch}。`;
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
      closeWorkspaceFileDiff();
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function createWorkspaceBranch(workspaceId: string, branch: string): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await createWorkspaceGitBranch(workspaceId, branch);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      const draft = workbenchDrafts.git[workspaceId];
      if (draft?.branchDraft.trim() === branch.trim()) workbenchDrafts.git[workspaceId] = { ...draft, branchDraft: '' };
      notice = `已创建并切换到 ${branch}。`;
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
      closeWorkspaceFileDiff();
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function syncWorkspaceBranch(workspaceId: string, action: GitSyncAction): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await syncWorkspaceGit(workspaceId, action);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = action === 'fetch' ? '已刷新远端状态。' : action === 'pull' ? '已拉取远端更改。' : '已推送本地更改。';
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitSyncBusy = false;
    }
  }

  async function saveWorkspaceStash(workspaceId: string): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await stashWorkspaceGit(workspaceId);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = '已保存当前更改到暂存栈。';
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitSyncBusy = false;
    }
  }

  async function applyWorkspaceStash(workspaceId: string, reference: string): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitStash(workspaceId, reference);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = `已应用 ${reference}。`;
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitSyncBusy = false;
    }
  }

  async function requestWorkspaceAgentReview(workspaceId: string): Promise<void> {
    const session = selectedSession;
    if (!session || session.workspaceId !== workspaceId || session.archived) {
      errorMessage = '请先选择当前工作区中的可用 Agent 会话。';
      return;
    }
    if (sessionRunning || workspaceGitReviewBusy) return;
    workspaceGitReviewBusy = true;
    errorMessage = null;
    const reviewProfile: ExecutionProfile = {
      schema: 'aibo.execution-profile/v1',
      interactionMode: 'ask',
      approvalPolicy: 'never',
      filesystemPolicy: 'read-only',
      commandPolicy: 'disabled',
      networkPolicy: 'disabled',
      model: executionProfile?.requested.model ?? null,
      reasoningEffort: executionProfile?.requested.reasoningEffort ?? null,
    };
    const changedFiles = workspaceChanges?.workspaceId === workspaceId ? workspaceChanges.files : [];
    const diffSections: string[] = [];
    let diffLength = 0;
    const maxReviewDiffLength = 120_000;
    for (const file of changedFiles) {
      for (const staged of file.staged ? [true, ...(file.unstaged ? [false] : [])] : [false]) {
        if (diffLength >= maxReviewDiffLength) break;
        try {
          const result = await getWorkspaceFileDiff(workspaceId, file.path, staged);
          if (!result.available || !result.diff) continue;
          const section = `\n\n### ${staged ? '暂存区' : '工作区'}：${file.path}\n${result.diff}`;
          const remaining = maxReviewDiffLength - diffLength;
          diffSections.push(section.slice(0, remaining));
          diffLength += Math.min(section.length, remaining);
        } catch {
          // A single unreadable file should not prevent reviewing the remaining changes.
        }
      }
    }
    const prompt = [
      '请审查当前工作区的 Git 变更。',
      '重点关注正确性、潜在回归、安全风险和缺失的测试；按优先级列出具体文件与行号，并在没有问题时明确说明。',
      '这是一个受执行策略约束的只读审查会话。请仅根据下方 diff 审查，不要尝试修改文件或执行命令。',
      diffSections.length > 0 ? diffSections.join('') : '当前没有可供审查的文本 diff。',
      diffLength >= maxReviewDiffLength ? '\n\n部分 diff 因长度限制已截断。' : '',
    ].join('\n');
    try {
      let reviewSession = await createAgentSession(workspaceId, session.agent, session.pluginInstallationId ?? undefined, reviewProfile);
      workspaceSessionMap = upsertSession(workspaceSessionMap, reviewSession);
      clearSelectedSessionContext();
      selectedSessionId = reviewSession.id;
      reviewSession = await sendAgentPrompt(reviewSession.id, prompt);
      workspaceSessionMap = upsertSession(workspaceSessionMap, reviewSession);
      void refreshTimeline(reviewSession.id);
      void refreshExecutionProfile(reviewSession.id);
      notice = '已在独立的只读会话中请求 Agent 审查 Git 变更。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitReviewBusy = false;
    }
  }

  async function loadWorkspaceCommitFiles(workspaceId: string, commit: string, append = false): Promise<void> {
    const generation = ++workspaceGitCommitFilesRequestGeneration;
    workspaceGitCommitFilesLoading = true;
    workspaceGitMetadataError = null;
    const offset = append && workspaceGitCommitFiles?.commit === commit ? workspaceGitCommitFiles.files.length : 0;
    if (!append) workspaceGitCommitFiles = null;
    try {
      const result = await listWorkspaceGitCommitFiles(workspaceId, commit, offset);
      if (generation === workspaceGitCommitFilesRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceGitCommitFiles = append && workspaceGitCommitFiles?.commit === commit
          ? { ...result, files: [...workspaceGitCommitFiles.files, ...result.files] }
          : result;
      }
    } catch (error) {
      if (generation === workspaceGitCommitFilesRequestGeneration && workspaceId === selectedWorkspaceId) {
        workspaceGitMetadataError = toErrorMessage(error);
      }
    } finally {
      if (generation === workspaceGitCommitFilesRequestGeneration) workspaceGitCommitFilesLoading = false;
    }
  }

  function closeWorkspaceCommitFiles(): void {
    ++workspaceGitCommitFilesRequestGeneration;
    workspaceGitCommitFiles = null;
    workspaceGitCommitFilesLoading = false;
  }

  async function openWorkspaceCommitFileDiff(workspaceId: string, commit: string, path: string): Promise<void> {
    const generation = ++workspaceFileDiffRequestGeneration;
    workspaceFileDiffPath = path;
    workspaceFileDiffStaged = false;
    workspaceFileDiffContextLabel = `提交 ${commit.slice(0, 8)}`;
    workspaceFileDiff = null;
    workspaceFileDiffLoading = true;
    workspaceFileDiffError = null;
    try {
      const diff = await getWorkspaceGitCommitFileDiff(workspaceId, commit, path);
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId) workspaceFileDiff = diff;
    } catch (error) {
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId) workspaceFileDiffError = toErrorMessage(error);
    } finally {
      if (generation === workspaceFileDiffRequestGeneration) workspaceFileDiffLoading = false;
    }
  }

  function toggleSidePanel(): void {
    sidePanelOpen = !sidePanelOpen;
  }

  function selectSidePanelView(view: SidePanelView): void {
    sidePanelView = view;
    sidePanelOpen = true;
    if (view !== 'git') closeWorkspaceFileDiff();
    if (view === 'git' && selectedWorkspaceId) {
      void refreshWorkspaceChanges(selectedWorkspaceId);
      void refreshWorkspaceGitMetadata(selectedWorkspaceId);
    }
  }

  async function applyWorkspaceGitAction(
    workspaceId: string,
    path: string,
    action: 'stage' | 'unstage',
  ): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = path;
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitFileAction(workspaceId, path, action);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = action === 'stage' ? `已暂存 ${path}` : `已取消暂存 ${path}`;
      await refreshWorkspaceChanges(workspaceId);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function applyWorkspaceGitWorkspaceAction(
    workspaceId: string,
    action: GitWorkspaceAction,
  ): Promise<void> {
    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitActionApi(workspaceId, action);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = action === 'stage_all' ? '已暂存全部更改。' : '已取消全部暂存。';
      await refreshWorkspaceChanges(workspaceId);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function commitWorkspaceGitChanges(workspaceId: string, message: string): Promise<boolean> {
    if (workspaceGitOperationBusy) return false;
    workspaceGitCommitBusy = true;
    errorMessage = null;
    try {
      const result = await commitWorkspaceChanges(workspaceId, message);
      if (!result.committed) {
        errorMessage = result.message;
        return false;
      }
      const draft = workbenchDrafts.git[workspaceId];
      if (draft?.commitMessage.trim() === message.trim()) workbenchDrafts.git[workspaceId] = { ...draft, commitMessage: '' };
      notice = result.hash ? `已创建提交 ${result.hash.slice(0, 8)}。` : '已创建提交。';
      await refreshWorkspaceChanges(workspaceId);
      await refreshWorkspaceGitMetadata(workspaceId);
      closeWorkspaceFileDiff();
      return true;
    } catch (error) {
      errorMessage = toErrorMessage(error);
      return false;
    } finally {
      workspaceGitCommitBusy = false;
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
      selectedAgent: selectedSessionAgent,
      timeline,
      pendingApprovals,
      pendingUserInputs,
      lastSubmittedPrompt,
      setAgentActivity,
      updateWorkspaceSessions,
      setPendingApprovals: (approvals) => (pendingApprovals = approvals),
      setPendingUserInputs: (requests) => (pendingUserInputs = requests),
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

  async function openWorkspaceLocation(workspaceId: string) {
    if (!desktop) return;
    try {
      await openWorkspaceLocationApi(workspaceId, 'finder');
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

  function profileForAccess(mode: SessionAccessMode): ExecutionProfile {
    const session = selectedSession;
    const agentKind = sessionAgentKind(session);
    const current = executionProfile?.requested ?? {
      schema: 'aibo.execution-profile/v1' as const,
      interactionMode: 'ask' as const,
      approvalPolicy: agentKind === 'pi' ? 'never' as const : 'on-request' as const,
      filesystemPolicy: 'read-only' as const,
      commandPolicy: 'disabled' as const,
      networkPolicy: 'disabled' as const,
      model: null,
      reasoningEffort: null,
    };
    if (agentKind === 'codex') {
      if (mode === 'full-access') {
        return { ...current, interactionMode: 'edit', approvalPolicy: 'never', filesystemPolicy: 'danger-full-access', commandPolicy: 'trusted', networkPolicy: 'agent-managed' };
      }
      if (mode === 'approve-for-me') {
        return { ...current, interactionMode: 'edit', approvalPolicy: 'never', filesystemPolicy: 'workspace-write', commandPolicy: 'trusted', networkPolicy: 'disabled' };
      }
      return { ...current, interactionMode: 'ask', approvalPolicy: 'untrusted', filesystemPolicy: 'workspace-write', commandPolicy: 'approved', networkPolicy: 'disabled' };
    }
    if (mode === 'workspace-write') {
      return {
        ...current,
        interactionMode: 'edit',
        approvalPolicy: 'on-request',
        filesystemPolicy: 'workspace-write',
        commandPolicy: 'approved',
      };
    }
    if (mode === 'plan') {
      return {
        ...current,
        interactionMode: 'plan',
        approvalPolicy: 'never',
        filesystemPolicy: 'read-only',
        commandPolicy: 'disabled',
      };
    }
    return {
      ...current,
      interactionMode: 'ask',
      approvalPolicy: 'never',
      filesystemPolicy: 'read-only',
      commandPolicy: 'disabled',
    };
  }

  async function applySessionAccess(mode: SessionAccessMode): Promise<void> {
    const session = selectedSession;
    if (!session) return;
    if (!desktop) {
      errorMessage = '当前是 Web 预览；请在 Tauri 桌面模式中调整会话权限。';
      return;
    }
    if (sessionRunning || selectedSessionArchiving) {
      errorMessage = '会话运行中不能切换权限，请等待当前回合结束。';
      return;
    }
    // Changing a profile closes the plugin runtime. Any model catalog request
    // started while the old runtime was open is expected to lose that race;
    // invalidate it before closing so its rejection cannot surface as a user
    // error after the profile update succeeds.
    ++sessionModelRequestGeneration;
    sessionModelCatalogLoading = false;
    ++commandSearchGeneration;
    busy = true;
    errorMessage = null;
    try {
      executionProfile = await updateSessionExecutionProfile(session.id, profileForAccess(mode));
      // The profile belongs to this session only. Keep the current list entry
      // coherent after the backend closes its idle runtime, without reloading
      // every session in the workspace (which also reloads unrelated list and
      // conversation context on this path).
      markSessionIdle(session);
      notice = sessionAgentKind(session) === 'codex'
        ? mode === 'full-access' ? 'Codex 已切换为 Full Access。' : mode === 'approve-for-me' ? 'Codex 已切换为 Approve for me。' : 'Codex 已切换为 Ask for approval。'
        : mode === 'workspace-write' ? '会话权限已切换为工作区写入。' : mode === 'plan' ? '会话已切换为计划模式。' : '会话权限已切换为只读。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    const session = selectedSession;
    const enabled = desktop;
    if (enabled && session && !session.archived && isSessionRunning(session)) {
      // A plugin rejects model/skill operations while a turn is active. Keep
      // the last catalog visible and invalidate any request that started
      // before the turn state reached the UI instead of surfacing a busy
      // error from that expected transition.
      untrack(() => {
        ++sessionModelRequestGeneration;
        sessionModelCatalogLoading = false;
      });
      return;
    }
    untrack(() => {
      ++sessionModelRequestGeneration;
      sessionModelCatalog = null;
      sessionModelOverride = null;
      sessionModelCatalogLoading = false;
      if (enabled && session && !session.archived) void loadSessionModels();
    });
  });

  async function loadSessionModels(): Promise<void> {
    const session = selectedSession;
    if (!desktop || !session || session.archived || isSessionRunning(session)) return;
    const generation = ++sessionModelRequestGeneration;
    sessionModelCatalogLoading = true;
    errorMessage = null;
    try {
      const catalog = await getSessionModels(session.id);
      if (generation === sessionModelRequestGeneration && selectedSessionId === session.id) {
        sessionModelCatalog = catalog;
        sessionModelOverride = null;
      }
    } catch (error) {
      if (generation === sessionModelRequestGeneration && selectedSessionId === session.id) {
        errorMessage = toErrorMessage(error);
      }
    } finally {
      if (generation === sessionModelRequestGeneration) sessionModelCatalogLoading = false;
    }
  }

  async function applyModelChange(change: ModelConfigurationChange): Promise<void> {
    const session = selectedSession;
    if (!session) return;
    if (!desktop) {
      errorMessage = '当前是 Web 预览；请在 Tauri 桌面模式中调整会话模型。';
      return;
    }
    if (busy || sessionRunning || selectedSessionArchiving) {
      errorMessage = '会话忙碌时不能切换模型或推理强度，请稍候重试。';
      return;
    }
    busy = true;
    errorMessage = null;
    const generation = ++sessionModelRequestGeneration;
    sessionModelCatalogLoading = false;
    const ownsSelection = () => selectedSessionId === session.id && generation === sessionModelRequestGeneration;
    try {
      const result = await modelConfigurationService.apply(session, change, sessionModelCatalog, executionProfile);
      if (result.profile && !session.pluginInstallationId) markSessionIdle(session);
      if (!ownsSelection()) return;
      if (result.profile) executionProfile = result.profile;
      sessionModelCatalog = result.catalog;
      sessionModelOverride = null;
      notice = `当前模型：${result.catalog.current?.label ?? '默认'} · ${result.catalog.currentReasoningEffort ?? '模型默认'}。`;
    } catch (error) {
      // A model update may have succeeded before a reasoning update failed.
      // Re-read the owner so the matrix does not pretend the combined operation rolled back.
      if (ownsSelection()) {
        errorMessage = toErrorMessage(error);
        try {
          const catalog = await getSessionModels(session.id);
          if (ownsSelection()) { sessionModelCatalog = catalog; sessionModelOverride = null; }
        } catch { /* Keep the original operation error; a later refresh can retry. */ }
      }
    } finally {
      busy = false;
    }
  }

  async function applySessionModel(model: string | null): Promise<void> {
    await applyModelChange({ kind: 'model', model });
  }

  async function applySessionReasoningEffort(reasoningEffort: string | null): Promise<void> {
    await applyModelChange({ kind: 'reasoning', reasoningEffort });
  }

  async function applySessionModelConfiguration(model: string, reasoningEffort: string | null): Promise<void> {
    await applyModelChange({ kind: 'configuration', model, reasoningEffort });
  }

  async function executePiBuiltinCommand(input: string): Promise<boolean> {
    const command = parseAgentCommand(input);
    if (!command || sessionAgentKind(selectedSession) !== 'pi') return false;

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
        openSettingsPanel();
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
          await agentFacade.invoke(session, 'compaction.run', { instructions: command.args });
          timeline = await getTimeline(session.id);
          notice = 'Pi 上下文压缩已完成。';
        });
        return true;
      case 'thinking':
        if (command.args) await applySessionReasoningEffort(command.args);
        else {
          await loadSessionModels();
          if (selectedSessionId === session.id && !errorMessage) notice = `当前推理强度：${sessionModelCatalog?.currentReasoningEffort ?? '模型默认'}。`;
        }
        if (selectedSessionId === session.id && composerText === input) composerText = '';
        return true;
      case 'model':
        if (command.args) await applySessionModel(command.args);
        else {
          await loadSessionModels();
          if (selectedSessionId === session.id && !errorMessage) notice = `当前模型：${sessionModelCatalog?.current?.label ?? '默认'}。`;
        }
        if (selectedSessionId === session.id && composerText === input) composerText = '';
        return true;
      case 'reload':
        if (command.args) {
          errorMessage = '/reload 不接受参数。';
          return true;
        }
        await run(async () => {
          const result = await agentFacade.invoke(session, 'session.reload', {});
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
    if (!command || sessionAgentKind(selectedSession) !== 'codex') return false;

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
        openSettingsPanel();
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
      case 'model':
        if (command.args) {
          await applySessionModel(command.args);
        } else {
          await loadSessionModels();
          if (!errorMessage) {
            notice = '模型列表已刷新，请从输入框右侧选择模型。';
          }
        }
        composerText = '';
        return true;
      case 'thinking':
        if (command.args) {
          await applySessionReasoningEffort(command.args);
        } else {
          await loadSessionModels();
          if (!errorMessage) {
            notice = `当前推理强度：${sessionModelCatalog?.currentReasoningEffort ?? '模型默认'}${sessionModelCatalog?.reasoningEfforts.length ? `（可选：${sessionModelCatalog.reasoningEfforts.map((item) => item.id).join('、')}）` : ''}`;
          }
        }
        composerText = '';
        return true;
      case 'plan':
        if (command.args) {
          errorMessage = '/plan 不接受参数。';
          return true;
        }
        await applySessionAccess('plan');
        if (!errorMessage) {
          notice = 'Codex 已切换到只读计划模式。';
        }
        composerText = '';
        return true;
      case 'goal':
        await run(async () => {
          if (command.args.toLocaleLowerCase() === 'clear') {
            await agentFacade.invoke(session, 'goal.manage', { action: 'clear' });
            codexGoal = null;
            notice = 'Codex 当前目标已清除。';
            return;
          }
          if (!command.args) {
            const result = await agentFacade.invoke(session, 'goal.manage', { action: 'get' });
            const goal = normalizeCodexGoal(result);
            notice = goal?.objective
              ? `当前目标：${goal.objective}${goal.status ? ` · ${goal.status}` : ''}`
              : '当前会话没有目标。';
            return;
          }
          const result = await agentFacade.invoke(session, 'goal.manage', { action: 'set', objective: command.args });
          codexGoal = normalizeCodexGoal(result) ?? {
            objective: command.args,
            status: 'active',
            tokenBudget: null,
            tokensUsed: null,
            updatedAt: null,
          };
          notice = `Codex 目标已设置：${command.args}`;
        });
        return true;
      case 'skills':
        if (command.args) {
          errorMessage = '/skills 不接受参数。';
          return true;
        }
        await run(async () => {
          agentCommands = await loadSessionCommands(session);
          notice = `已刷新 Codex Skills（${agentCommands.length} 项）。`;
        });
        return true;
      default:
        return false;
    }
  }

  async function sendPrompt() {
    if (await dispatchBuiltinCommand(selectedSession, composerText, { codex: executeCodexBuiltinCommand, pi: executePiBuiltinCommand })) return;
    await messageController.sendPrompt();
  }

  async function retryLastPrompt() {
    await messageController.retryLastPrompt();
  }

  async function abortPrompt() {
    await messageController.abortPrompt();
    if (!errorMessage && selectedSessionId) {
      pendingUserInputs = pendingUserInputs.filter((request) => request.sessionId !== selectedSessionId);
    }
  }

  async function compactCurrentSession(): Promise<void> {
    const session = selectedSession;
    if (!session || sessionAgentKind(session) !== 'pi' || session.archived) return;
    if (sessionRunning || busy) {
      errorMessage = '会话运行中不能手动压缩，请等待当前回合结束。';
      return;
    }
    busy = true;
    errorMessage = null;
    setAgentActivity(session.id, true, 'Pi 正在压缩上下文…');
    try {
      await agentFacade.invoke(session, 'compaction.run', {});
      if (selectedSessionId === session.id) timeline = await getTimeline(session.id);
      setAgentActivity(session.id, false);
      notice = 'Pi 上下文压缩已完成。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
      setAgentActivity(session.id, false);
    } finally {
      busy = false;
    }
  }

  async function queuePiPrompt(mode: 'steer' | 'followUp') {
    if (sessionAgentKind(selectedSession) === 'pi' && await executePiBuiltinCommand(composerText)) return;
    await messageController.queuePiPrompt(mode);
  }

  async function clearPiPromptQueue() {
    const session = selectedSession;
    if (!session || !session.capabilities.includes('queue.manage')) return;
    try {
      await agentFacade.invoke(session, 'queue.manage', { action: 'clear' });
      const loadedTimeline = await getTimeline(session.id);
      if (selectedSessionId !== session.id) return;
      queueSnapshot = null;
      timeline = loadedTimeline;
      notice = '已清空待处理消息。';
    } catch (error) {
      if (selectedSessionId === session.id) errorMessage = toErrorMessage(error);
    }
  }

  function requestPiTreeNavigation(entryId: string) {
    piNavigationMode = 'none';
    piNavigationCustomInstructions = '';
    piTreeController.requestNavigation(entryId);
  }

  function openPiTree(): void {
    if (!selectedSession || !selectedSession.capabilities.includes('session.tree')) return;
    piTreeOpen = true;
    void refreshPiTree(selectedSession.id);
  }

  async function confirmPiTreeNavigation(options: PiTreeNavigationOptions) {
    piNavigationStatus = options.mode === 'none'
      ? '正在切换会话树节点…'
      : '正在生成分支总结并切换节点…';
    try {
      const switched = await piTreeController.confirmNavigation(options);
      if (switched) piTreeOpen = false;
    } finally {
      piNavigationStatus = null;
    }
  }

  async function resolveApproval(approval: ApprovalRequest, decision: ApprovalDecision) {
    await approvalController.resolveApproval(approval, decision);
  }

  async function resolveUserInput(request: UserInputRequest, answers: Record<string, string[]>): Promise<void> {
    if (!desktop || request.sessionId !== selectedSessionId) return;
    busy = true;
    errorMessage = null;
    try {
      await resolveAgentUserInput(request.sessionId, request.requestId, answers);
      pendingUserInputs = pendingUserInputs.filter(
        (item) => item.sessionId !== request.sessionId || item.requestId !== request.requestId,
      );
      notice = '已提交你的回答，Agent 将继续执行。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
      throw error;
    } finally {
      busy = false;
    }
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

  async function forkSession(sessionId = selectedSessionId, throughTurnId?: string) {
    await sessionLifecycle.forkSession(sessionId, throughTurnId);
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
    if (id === selectedSessionId) return;
    navigationController.selectSession(id);
  }

  async function toggleTrust(workspace: Workspace) {
    await workspaceController.toggleTrust(workspace);
  }

  async function deleteWorkspace(workspace: Workspace) {
    await workspaceController.deleteWorkspace(workspace);
  }

  function activateWorkspace(id: string) {
    if (id !== selectedWorkspaceId) {
      projectActionRuns = [];
      closeWorkspaceFileDiff();
      closeWorkspaceCommitFiles();
    }
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
      listCodexThreads, readCodexThread, getPiSessionTree,
          getTimeline,
        invokeAgentCapability,
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
    setSelectedWorkspaceId: setSelectedWorkspace,
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setExpandedWorkspaceIds: (value) => (expandedWorkspaceIds = value),
    setCreateSessionWorkspaceId: (value) => (createSessionWorkspaceId = value),
    setTimelineVisibleCount: (value) => (timelineVisibleCount = value),
    setCodexThreads: (value) => (codexThreads = value),
    setProjectActions: (value) => (projectActions = value),
    setProjectActionRuns: (value) => (projectActionRuns = value),
    setWorkspaceCapabilities: (value) => (workspaceCapabilities = value),
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
      forkCodexThread,
      closeAgentSession,
      renameSession: renameSessionApi,
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
    getSelectedWorkspaceId: () => selectedWorkspaceId,
    api: {
      createSession: (workspaceId, agentId, profile) => createAgentSession(workspaceId, agentId, undefined, profile),
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
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    clearSelectedSessionContext,
    refreshCodexThreads,
    refreshPiTree,
    refreshTurnChangeSet,
    refreshExecutionProfile,
    refreshSessions,
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
    setSelectedWorkspaceId: setSelectedWorkspace,
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
    getSessionsLoadingWorkspaceIds: () => sessionsLoadingWorkspaceIds,
    setWorkspaces: (value) => (workspaces = value),
    setDiagnostics: (value) => (diagnostics = value),
    setSelectedWorkspaceId: setSelectedWorkspace,
    setSelectedSessionId: (value) => (selectedSessionId = value),
    setExpandedWorkspaceIds: (value) => (expandedWorkspaceIds = value),
    setWorkspaceSessionMap: (value) => (workspaceSessionMap = value),
    setSessionsLoadingWorkspaceIds: (value) => (sessionsLoadingWorkspaceIds = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
    clearSelectedSessionContext,
    refreshTimeline,
    refreshCodexThreads,
    refreshCodexThread,
    refreshPiTree,
    refreshExecutionProfile,
    refreshTurnChangeSet,
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

  const agentFacade = createAgentFacade({ invokeAgentCapability, legacyCapability: legacyCapability(legacyAgentOperations) });
  const modelConfigurationService = createModelConfigurationService({
    facade: agentFacade,
    getSessionModels,
    getSessionExecutionProfile,
    legacyApply: createLegacyModelConfiguration({ updateSessionExecutionProfile }),
  });

  const messageController = createMessageController({
    api: {
      createDefaultSession: (workspaceId) => createAgentSession(workspaceId, 'dev.aibo.codex.agent'),
      sendAgentPrompt,
      cancelAgentTurn,
      invokeAgentCapability,
      validateSessionAttachments,
    },
    getDesktop: () => desktop,
    getSelectedWorkspace: () => selectedWorkspace,
    getSelectedSession: () => selectedSession,
    getSelectedSessionArchiving: () => selectedSessionArchiving,
    getSessionRunning: () => sessionRunning,
    getComposerText: () => composerText,
    setComposerText: (value) => (composerText = value),
    consumeDraft: (sessionId, submitted) => {
      if (selectedSessionId === sessionId && composerText === submitted) composerText = '';
      if (composerDrafts[sessionId]?.text === submitted) {
        const next = { ...composerDrafts };
        delete next[sessionId];
        composerDrafts = next;
        writePersistedComposerDrafts(next);
        scheduleComposerDraftWrite(sessionId, '', false, true);
      }
    },
    setComposerDraftStatus: (sessionId, sendFailed) => {
      const draft = composerDrafts[sessionId];
      if (!draft) return;
      const next = {
        ...composerDrafts,
        [sessionId]: { ...draft, sendFailed, updatedAt: new Date().toISOString() },
      };
      composerDrafts = next;
      writePersistedComposerDrafts(next);
    },
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

  $effect(() => {
    const workspaceId = selectedWorkspaceId;
    if (!desktop || !workspaceId || !inspectorOpen || sidePanelView !== 'context') return;
    return observeProjectTaskHistory({
      read: () => listProjectActionRuns(workspaceId),
      publish: (runs) => {
        // A read started before settlement must not regress a known terminal run.
        projectActionRuns = runs.map((run) => {
          const existing = projectActionRuns.find((item) => item.id === run.id);
          const rank = (status: string) => status === 'awaiting_approval' ? 0 : status === 'running' ? 1 : 2;
          return existing && rank(existing.status) > rank(run.status) ? existing : run;
        });
      },
      error: (error) => console.warn('unable to observe project task history', error),
    });
  });

  const projectTaskController = createProjectTaskController({ requestId: () => crypto.randomUUID(), execute: runProjectAction });

  const approvalController = createApprovalController({
    api: { resolveAgentApproval },
    getDesktop: () => desktop,
    getPendingApprovals: () => pendingApprovals,
    setPendingApprovals: (value) => (pendingApprovals = value),
    setBusy: (value) => (busy = value),
    setErrorMessage: (value) => (errorMessage = value),
    setNotice: (value) => (notice = value),
  });

  const piTreeController = createPiTreeController({
    api: {
      navigatePiSessionTree, invokeAgentCapability, getTimeline },
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
  <WindowTitlebar
    onOpenPlugins={openPluginPanel}
    onOpenHistory={openExecutionHistory}
    onOpenSessionHistory={openSessionHistory}
    onOpenSettings={openSettingsPanel}
    onOpenDiagnostics={openDiagnosticsPanel}
    sidePanelOpen={sidePanelOpen}
    onToggleSidePanel={toggleSidePanel}
    onToggleMaximize={toggleMaximizeWindow}
    onMinimize={minimizeAppWindow}
    onClose={closeAppWindow}
  />
  <SettingsPanel
    open={settingsOpen}
    uiKits={availableUiKits}
    activeUiKitName={$activeUiKitName}
    activeThemeId={$activeTheme.id}
    onSelectUiKit={setUiKit}
    onSelectTheme={setUiTheme}
    onClose={() => (settingsOpen = false)}
  />
  <DiagnosticsPanel
    open={diagnosticsOpen}
    diagnostics={diagnostics}
    desktop={desktop}
    workspaceCount={workspaces.length}
    sessionCount={sessions.length}
    busy={busy}
    onRefresh={() => void refresh()}
    onClose={() => (diagnosticsOpen = false)}
  />
  {#if pendingApprovals.length > 0}
    <section class="approval-list" aria-label="宿主审批" aria-live="assertive" style="max-height: 40vh; overflow: auto; flex-shrink: 0;">
      {#each pendingApprovals as approval (JSON.stringify([approval.sessionId, approval.requestId]))}
        <Card class="approval-card">
          <CardHeader class="approval-card-heading">
            <CardTitle>需要确认 · {sessions.find(session => session.id === approval.sessionId)?.label ?? approval.sessionId}</CardTitle>
            <Badge variant="warning">{approval.kind}</Badge>
          </CardHeader>
          <CardContent class="approval-card-content">
            {#if approval.command}<code>{approval.command}</code>{/if}
            {#if approval.cwd}<small>{approval.cwd}</small>{/if}
            <div class="approval-actions">
              {#if approval.availableDecisions.includes('cancel')}
                <Button variant="ghost" size="sm" onclick={() => void resolveApproval(approval, 'cancel')} disabled={busy}>拒绝</Button>
              {/if}
              {#if approval.availableDecisions.includes('accept')}
                <Button size="sm" onclick={() => void resolveApproval(approval, 'accept')} disabled={busy}>允许</Button>
              {/if}
            </div>
          </CardContent>
        </Card>
      {/each}
    </section>
  {/if}
  {#if capabilityHistoryOpen}
    <div class="host-capability-history-region" style="order:2;display:grid;flex:1;min-height:0;overflow:auto;">
      <CapabilityHistoryPanel state={capabilityHistory} {desktop} onSelect={scope=>void capabilityHistoryController.select(scope)}
        onReload={()=>void capabilityHistoryController.open()} onMoreScopes={()=>void capabilityHistoryController.moreScopes()}
        onRefresh={()=>void capabilityHistoryController.refresh()} onOlder={()=>void capabilityHistoryController.older()}
        onNewer={()=>void capabilityHistoryController.newer()} onLatest={()=>void capabilityHistoryController.latest()} onBack={backFromCapabilityHistory} />
    </div>
  {/if}
  {#if sessionHistoryOpen}
    <div class="host-session-history-region" style="order:2; display:grid; flex:1; min-height:0; overflow:auto;">
      <SessionHistoryPanel {workspaces} workspaceId={sessionHistoryWorkspaceId} state={sessionHistory} {desktop}
        onWorkspace={id=>{sessionHistoryWorkspaceId=id;}} onSession={id=>void sessionHistoryController.select(id)}
        onRefresh={()=>void sessionHistoryController.refresh()} onOlder={()=>void sessionHistoryController.older()}
        onNewer={()=>void sessionHistoryController.newer()} onLatest={()=>void sessionHistoryController.latest()} onClose={closeSessionHistory}
        onReload={()=>{if (sessionHistoryWorkspaceId) void sessionHistoryController.open(sessionHistoryWorkspaceId, sessionHistory.selectedId);}} />
    </div>
  {/if}
  {#if historyOpen}
    <div class="host-history-region" style="order: 2; display: grid; flex: 1; min-height: 0; overflow: auto;">
      <ExecutionHistoryPanel {workspaces} workspaceId={historyWorkspaceId} windowId={presentationWindowId()} state={executionHistory} {desktop}
        onOpenAudit={openCapabilityHistory} onSelectWorkspace={id => { historyWorkspaceId = id; }} onRefresh={() => void executionHistoryController.refresh()}
        onStop={key => void executionHistoryController.stop(key)} onClose={closeExecutionHistory}
        onOlder={() => void executionHistoryController.older()} onNewer={() => void executionHistoryController.newer()} onLatest={() => void executionHistoryController.latest()} />
    </div>
  {/if}
  {#if pluginsOpen}
    <div class="host-plugin-region" style="order: 2; display: grid; flex: 1; min-height: 0; overflow: auto;">
      <PluginWorkspacePanel interaction={workbenchDrafts.plugin} onInteractionChange={hostGuard('onInteractionChange', (value) => { workbenchDrafts.plugin = value; })}
      installations={pluginInstallations}
      sessions={pluginSessions.filter((session) => session.workspaceId === selectedWorkspaceId)}
      selectedSession={pluginSession?.workspaceId === selectedWorkspaceId ? pluginSession : null}
      workspaceLabel={selectedWorkspace?.label ?? null}
      packagePath={pluginPackagePath}
      prompt={pluginSessionId ? composerText : ''}
      timeline={timeline.filter((item) => item.sessionId === pluginSessionId)}
      views={pluginViewSessionId === pluginSessionId ? pluginViews : []}
      busy={pluginBusy}
      error={pluginError || errorMessage || ''}
      {desktop}
      onPackagePathChange={hostGuard('onPackagePathChange', (value) => { pluginPackagePath = value; })}
      onPromptChange={hostGuard('onPromptChange', (value) => { if (pluginSessionId) { composerText = value; handleComposerInput(value); } })}
      onInstall={hostGuard('onInstall', () => void installPlugin())}
      onEnabledChange={hostGuard('onEnabledChange', (id, enabled) => void enablePlugin(id, enabled))}
      onUninstall={hostGuard('onUninstall', (id) => void uninstallPlugin(id))}
      onCreateSession={hostGuard('onCreateSession', (installationId, agentId) => void createPluginSession(installationId, agentId))}
      onSelectSession={hostGuard('onSelectSession', selectSession)}
      onSend={hostGuard('onSend', () => void sendPluginPrompt())}
      onCancel={hostGuard('onCancel', () => pluginSessionOperation(cancelAgentTurn))}
      onResume={hostGuard('onResume', () => pluginSessionOperation(resumeAgentSession))}
      onCloseSession={hostGuard('onCloseSession', () => pluginSessionOperation(closeAgentSession))}
      onViewAction={hostGuard('onViewAction', (viewId, actionId, input, version) => void invokePluginAction(viewId, actionId, input, version))}
      onClose={hostGuard('onClose', () => { pluginsOpen = false; })}
    />
    </div>
  {/if}
<WorkbenchPresentation suspended={pluginsOpen || historyOpen || sessionHistoryOpen || capabilityHistoryOpen} windowId={presentationWindowId()} snapshot={{ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId, draft: composerText, navigation: sidePanelView, timelineRevision: timeline.length }}>
{#snippet children(guard)}
  <main
    bind:this={workspaceGridElement}
    class:inspector-hidden={!inspectorOpen}
    class="workspace-grid"
    style={`--workspace-sidebar-width: ${workspaceSidebarWidth}px; --workspace-inspector-width: ${inspectorWidth}px`}
  >
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
      bind:sessionSearch={() => sessionSearch, guard('bind:sessionSearch', (value) => { sessionSearch = value; })}
      bind:sessionFilter={() => sessionFilter, guard('bind:sessionFilter', (value) => { sessionFilter = value; })}
      createSessionWorkspaceId={createSessionWorkspaceId}
      renamingSessionId={renamingSessionId}
      bind:sessionLabelDraft={() => sessionLabelDraft, guard('bind:sessionLabelDraft', (value) => { sessionLabelDraft = value; })}
      onToggleSearch={guard('onToggleSearch', () => (sessionSearchOpen = !sessionSearchOpen))}
      onToggleFilter={guard('onToggleFilter', () => (sessionFilterOpen = !sessionFilterOpen))}
      onApplyFilters={guard('onApplyFilters', () => void refreshExpandedSessions())}
      onChooseWorkspaceDirectory={guard('onChooseWorkspaceDirectory', () => void chooseWorkspaceDirectory())}
      onSelectWorkspace={guard('onSelectWorkspace', selectWorkspace)}
      onToggleSessionCreator={guard('onToggleSessionCreator', toggleSessionCreator)}
      onToggleTrust={guard('onToggleTrust', (workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void toggleTrust(workspace);
      })}
      onDeleteWorkspace={guard('onDeleteWorkspace', (workspaceId) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (workspace) void deleteWorkspace(workspace);
      })}
      onOpenWorkspaceLocation={guard('onOpenWorkspaceLocation', (workspaceId) => void openWorkspaceLocation(workspaceId))}
      onCreateCodex={guard('onCreateCodex', (workspaceId) => {
        if (workspaceId !== selectedWorkspaceId) activateWorkspace(workspaceId);
        void createCodex();
      })}
      onCreatePi={guard('onCreatePi', (workspaceId) => {
        if (workspaceId !== selectedWorkspaceId) activateWorkspace(workspaceId);
        void createPi();
      })}
      onSelectSession={guard('onSelectSession', (id) => { installedTool = null; pluginsOpen = false; selectSession(id); })}
      onUnarchiveSession={guard('onUnarchiveSession', (sessionId) => void unarchiveSession(sessionId))}
      onRequestArchiveSession={guard('onRequestArchiveSession', requestArchiveSession)}
      onSyncCodexThread={guard('onSyncCodexThread', (sessionId) => void syncCodexThread(sessionId))}
      onBeginRenameSession={guard('onBeginRenameSession', beginRenameSession)}
      onSaveSessionRename={guard('onSaveSessionRename', () => void saveSessionRename())}
      onCancelRenameSession={guard('onCancelRenameSession', cancelRenameSession)}
    />
    <ColumnSplitter
      label="调整工作区与会话宽度"
      width={workspaceSidebarWidth}
      onPointerDown={guard('onPointerDown', (event) => beginColumnResize('workspace', event))}
      onKeyDown={guard('onKeyDown', (event) => handleSplitterKeydown('workspace', event))}
    />
    {#if installedTool && contributionAvailable(installedTool)}
      {#key JSON.stringify([installedScope,installedTool.installationId,installedTool.contributionId])}
        {#await loadInstalledWorkbench() then workbench}
          <workbench.default workspaceId={selectedWorkspaceId ?? ""} invocationScope={installedScope} contribution={installedTool} port={installedPort} stateStore={presentationState} onClose={guard('onClose', () => installedTool = null)} />
        {/await}
      {/key}
    {:else if workspaceFileDiffPath !== null || workspaceFileDiff || workspaceFileDiffLoading || workspaceFileDiffError}
    <WorkspaceFileDiffPreview
      fileDiff={workspaceFileDiff}
      fileDiffLoading={workspaceFileDiffLoading}
      fileDiffError={workspaceFileDiffError}
      selectedPath={workspaceFileDiffPath}
      selectedStaged={workspaceFileDiffStaged}
      contextLabel={workspaceFileDiffContextLabel}
      onClose={guard('onClose', closeWorkspaceFileDiff)}
    />
    {:else}
    <TimelinePanel
      workspace={selectedWorkspace}
      session={selectedSession}
      selectedSessionId={selectedSessionId}
      {codexGoal}
      codexThreadSnapshot={codexThreadSnapshot}
      timeline={timeline}
      timelineVisibleCount={timelineVisibleCount}
      usageValues={usageValues}
      retryPrompt={retryPrompt}
      retryReason={retryReason}
      userInputRequests={selectedUserInputRequests}
      queueSnapshot={queueSnapshot}
      agentActivityLabel={agentActivityLabel}
      contextCompacting={contextCompacting}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      busy={busy}
      attachments={attachments}
      executionProfile={executionProfile}
      modelConfiguration={modelConfigurationState(selectedSession, sessionModelCatalog, executionProfile)}
      modelCatalog={sessionModelCatalog}
      modelCatalogLoading={sessionModelCatalogLoading}
      modelOverride={sessionModelOverride}
      workspacePathSuggestions={workspacePathSuggestions}
      agentCommands={visibleAgentCommands}
      agentCommandsLoading={agentCommandsLoading}
      composerDraftFailed={composerDraftFailed}
      bind:composerText={() => composerText, guard('bind:composerText', (value) => { composerText = value; })}
      onComposerInput={guard('onComposerInput', handleComposerInput)}
      onSelectWorkspacePath={guard('onSelectWorkspacePath', selectComposerWorkspacePath)}
      onAddAttachments={guard('onAddAttachments', () => void chooseSessionAttachments())}
      onAddDirectory={guard('onAddDirectory', () => void chooseSessionAttachmentDirectory())}
      onRemoveAttachment={guard('onRemoveAttachment', (attachmentId) => void removeAttachment(attachmentId))}
      onLoadOlderTimeline={guard('onLoadOlderTimeline', loadOlderTimeline)}
      onForkSession={guard('onForkSession', (throughTurnId) => void forkSession(selectedSessionId, throughTurnId))}
      onOpenPiTree={guard('onOpenPiTree', openPiTree)}
      onTimelineScroll={guard('onTimelineScroll', handleTimelineScroll)}
      onRetry={guard('onRetry', () => void retryLastPrompt())}
      onResolveUserInput={guard('onResolveUserInput', (request, answers) => resolveUserInput(request, answers))}
      onCancelUserInput={guard('onCancelUserInput', (request) => {
        if (request.sessionId === selectedSessionId) void abortPrompt();
      })}
      onSend={guard('onSend', () => void sendPrompt())}
      onQueue={guard('onQueue', (mode) => void queuePiPrompt(mode))}
      onClearQueue={guard('onClearQueue', () => void clearPiPromptQueue())}
      onAbort={guard('onAbort', () => void abortPrompt())}
      onSelectAccess={guard('onSelectAccess', (mode) => void applySessionAccess(mode))}
      onLoadModels={guard('onLoadModels', () => void loadSessionModels())}
      onSelectModelConfiguration={guard('onSelectModelConfiguration', (model, reasoningEffort) => void applySessionModelConfiguration(model, reasoningEffort))}
      onCompact={guard('onCompact', () => void compactCurrentSession())}
    />
    {/if}
    {#if sidePanelOpen}
      <ColumnSplitter
        label="调整会话与侧边栏宽度"
        width={inspectorWidth}
        onPointerDown={guard('onPointerDown', (event) => beginColumnResize('inspector', event))}
        onKeyDown={guard('onKeyDown', (event) => handleSplitterKeydown('inspector', event))}
      />
      {#if sidePanelView === 'context'}
      <Inspector
      visible={true}
      workspace={selectedWorkspace}
      session={selectedSession}
      desktop={desktop}
      activeView={sidePanelView}
      {diagnostics}
      workspaceCapabilities={workspaceCapabilities}
      codexThreads={codexThreads}
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
      onSyncCodexThreads={guard('onSyncCodexThreads', () => void syncCodexThreads())}
      onRestoreTurnChangeSet={guard('onRestoreTurnChangeSet', restoreTurnChangeSet)}
      onShowTurnFileDiff={guard('onShowTurnFileDiff', showTurnFileDiff)}
      onApplyGitFileAction={guard('onApplyGitFileAction', applyGitFileActionFromInspector)}
      onApplyGitHunkAction={guard('onApplyGitHunkAction', applyGitHunkActionFromInspector)}
      onReadArtifact={guard('onReadArtifact', readArtifact)}
      onSaveProjectAction={guard('onSaveProjectAction', async (input) => {
        try {
          const saved = await saveProjectAction(input);
          projectActions = projectActions.some((item) => item.id === saved.id)
            ? projectActions.map((item) => (item.id === saved.id ? saved : item))
            : [...projectActions, saved];
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }
      })}
      onDeleteProjectAction={guard('onDeleteProjectAction', async (actionId) => {
        try {
          if (selectedWorkspaceId) {
            await deleteProjectAction(selectedWorkspaceId, actionId);
            projectActions = projectActions.filter((item) => item.id !== actionId);
          }
        } catch (error) {
          errorMessage = toErrorMessage(error);
        }
      })}
      onCancelProjectAction={guard('onCancelProjectAction', async (runId) => {
        const workspaceId = selectedWorkspaceId;
        if (!workspaceId) return;
        try {
          const requested = await cancelProjectAction(workspaceId, runId);
          if (selectedWorkspaceId === workspaceId) notice = requested ? '已请求停止，正在等待执行结束；已有更改不会自动撤销。' : '该执行已结束或不属于当前工作区。';
        } catch (error) {
          if (selectedWorkspaceId === workspaceId) errorMessage = toErrorMessage(error);
        }
      })}
      onRunProjectAction={guard('onRunProjectAction', async (actionId) => {
        const workspaceId = selectedWorkspaceId;
        const sessionId = selectedSessionId;
        if (!workspaceId) return;
        try {
          const result = await projectTaskController.run(workspaceId, actionId, sessionId);
          if (selectedWorkspaceId !== workspaceId) return;
          projectActionRuns = [result, ...projectActionRuns.filter((item) => item.id !== result.id)].slice(0, 20);
          if (sessionId && selectedSessionId === sessionId) await refreshArtifacts(sessionId);
          if (selectedWorkspaceId !== workspaceId) return;
          notice = result.status === 'rejected' ? '工程动作未执行，请查看审批结果。' : result.status === 'awaiting_approval' ? '工程动作正在等待宿主批准。' : result.status === 'running' ? '工程动作正在执行。' : result.status === 'outcome_unknown' ? '工程动作结果未知，请核对实际更改后再操作。' : result.status === 'completed' ? '工程动作已完成。' : `工程动作${result.status === 'timed_out' ? '超时' : '失败'}。`;
        } catch (error) {
          if (selectedWorkspaceId === workspaceId) errorMessage = toErrorMessage(error);
        }
      })}
      onRefresh={guard('onRefresh', () => void refresh())}
      onSelectView={guard('onSelectView', selectSidePanelView)}
      />
      {:else if sidePanelView === 'git'}
        {#key selectedWorkspaceId}
        <WorkspaceGitPanel draftState={workbenchDrafts.git[selectedWorkspaceId ?? ''] ?? emptyGitPanelState()} onDraftChange={guard('onDraftChange', (value) => { if (selectedWorkspaceId) workbenchDrafts.git[selectedWorkspaceId] = value; })}
          workspace={selectedWorkspace}
          desktop={desktop}
          changes={workspaceChanges}
          loading={workspaceChangesLoading}
          error={workspaceChangesError}
          selectedFilePath={workspaceFileDiffPath}
          selectedFileStaged={workspaceFileDiffStaged}
          branches={workspaceGitBranches}
          history={workspaceGitHistory}
          gitMetadataLoading={workspaceGitMetadataLoading}
          gitMetadataError={workspaceGitMetadataError}
          commitFiles={workspaceGitCommitFiles}
          commitFilesLoading={workspaceGitCommitFilesLoading}
          remoteStatus={workspaceGitRemoteStatus}
          stashes={workspaceGitStashes}
          operationBusy={workspaceGitOperationBusy}
          reviewBusy={workspaceGitReviewBusy}
          canRequestReview={selectedSession !== null && selectedSession.workspaceId === selectedWorkspaceId && !selectedSession.archived && !sessionRunning}
          activeView={sidePanelView}
          onRefresh={guard('onRefresh', () => selectedWorkspaceId && void refreshWorkspaceChanges(selectedWorkspaceId))}
          onApplyFileAction={guard('onApplyFileAction', (workspaceId, path, action) => void applyWorkspaceGitAction(workspaceId, path, action))}
          onApplyWorkspaceAction={guard('onApplyWorkspaceAction', (workspaceId, action) => void applyWorkspaceGitWorkspaceAction(workspaceId, action))}
          onCommit={guard('onCommit', (workspaceId, message) => commitWorkspaceGitChanges(workspaceId, message))}
          onOpenDiff={guard('onOpenDiff', (workspaceId, path, staged) => void openWorkspaceFileDiff(workspaceId, path, staged))}
          onRefreshGitMetadata={guard('onRefreshGitMetadata', (workspaceId) => void refreshWorkspaceGitMetadata(workspaceId))}
          onCheckoutBranch={guard('onCheckoutBranch', (workspaceId, branch) => void checkoutWorkspaceBranch(workspaceId, branch))}
          onCreateBranch={guard('onCreateBranch', (workspaceId, branch) => void createWorkspaceBranch(workspaceId, branch))}
          onSelectCommit={guard('onSelectCommit', (workspaceId, commit) => void loadWorkspaceCommitFiles(workspaceId, commit))}
          onLoadMoreCommitFiles={guard('onLoadMoreCommitFiles', (workspaceId, commit) => void loadWorkspaceCommitFiles(workspaceId, commit, true))}
          onOpenCommitFileDiff={guard('onOpenCommitFileDiff', (workspaceId, commit, path) => void openWorkspaceCommitFileDiff(workspaceId, commit, path))}
          onSync={guard('onSync', (workspaceId, action) => void syncWorkspaceBranch(workspaceId, action))}
          onSaveStash={guard('onSaveStash', (workspaceId) => void saveWorkspaceStash(workspaceId))}
          onApplyStash={guard('onApplyStash', (workspaceId, reference) => void applyWorkspaceStash(workspaceId, reference))}
          onRequestReview={guard('onRequestReview', (workspaceId) => void requestWorkspaceAgentReview(workspaceId))}
          onSelectView={guard('onSelectView', selectSidePanelView)}
        />
        {/key}
      {/if}
    {/if}
  </main>

  <CommandPalette
    open={commandPaletteOpen}
    commands={commandPaletteCommands}
    onClose={guard('onClose', () => (commandPaletteOpen = false))}
  />
  <PiSessionTreeOverlay
    open={piTreeOpen && selectedSession?.capabilities.includes('session.tree')}
    session={selectedSession}
    tree={piTree?.sessionId === selectedSessionId ? piTree : null}
    {busy}
    {sessionRunning}
    {selectedSessionArchiving}
    navigationStatus={piNavigationStatus}
    onClose={guard('onClose', () => {
      if (!piNavigationStatus) piTreeOpen = false;
    })}
    onRefresh={guard('onRefresh', (sessionId) => void refreshPiTree(sessionId))}
    onSelectNode={guard('onSelectNode', requestPiTreeNavigation)}
  />
  <AppOverlays
    {errorMessage}
    {notice}
    archiveConfirmationOpen={archiveConfirmationSessionId !== null}
    piNavigationOpen={piNavigationEntryId !== null}
    {piNavigationMode}
    {piNavigationCustomInstructions}
    onConfirmArchive={guard('onConfirmArchive', () => void confirmArchiveSession())}
    onCancelArchive={guard('onCancelArchive', () => (archiveConfirmationSessionId = null))}
    onSetPiNavigationMode={guard('onSetPiNavigationMode', (mode) => (piNavigationMode = mode))}
    onSetPiNavigationCustomInstructions={guard('onSetPiNavigationCustomInstructions', (value) => (piNavigationCustomInstructions = value))}
    onConfirmPiNavigation={guard('onConfirmPiNavigation', (options) => void confirmPiTreeNavigation(options))}
    onCancelPiNavigation={guard('onCancelPiNavigation', () => (piNavigationEntryId = null))}
  />
{/snippet}
</WorkbenchPresentation>
</div>
