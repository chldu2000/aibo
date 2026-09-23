<script lang="ts">
  import { createSessionDiffController, emptySessionDiff } from '$lib/app/session-diff-controller';
  let sessionTabs = $state<Record<string, 'conversation' | 'executions' | 'changes'>>({});
  let sessionDiff = $state(emptySessionDiff());
  const sessionDiffController = createSessionDiffController(getWorkspaceFileDiff, value => { sessionDiff = value; });
  $effect(() => { selectedSessionId; selectedWorkspaceId; sessionDiffController.close(); });

  import { createAttachmentPreviews } from '$lib/app/attachment-previews';
  import { getSessionAttachmentPreview } from '$lib/api';
  import { SubagentDetails, WorkspacePreferencesPanel } from '$lib/components/app';
  import { createWorkspacePreferencesController, emptyWorkspacePreferences } from '$lib/app/workspace-preferences-controller';
  import { readWorkspacePreferences, saveWorkspacePreferences } from '$lib/api';
  import { getSubagentHistory } from '$lib/api';
  import { parseSubagent, mergeSubagentEntries, type SubagentEntry } from '$lib/app/subagents';
  let subagentSelection = $state<{sessionId:string; id:string} | null>(null);
  let subagentOpen = $state(false);
  let subagentEntries = $state<SubagentEntry[]>([]);
  let subagentLoading = $state(false);
  let subagentError = $state<string | null>(null);
  let subagentGeneration = 0;
  let subagentLive: SubagentEntry[] = [];
  const selectedSubagent = $derived(subagentSelection?.sessionId === selectedSessionId
    ? timeline.filter(item => item.toolName === 'subagent').map(item => parseSubagent(item.content)).find(agent => agent?.id === subagentSelection?.id) ?? null : null);
  async function openSubagent(id: string) {
    if (!selectedSessionId) return;
    const sessionId = selectedSessionId;
    const generation = ++subagentGeneration;
    if (subagentSelection?.id !== id || subagentSelection?.sessionId !== sessionId) subagentEntries = [];
    subagentSelection = {sessionId,id}; subagentOpen = true; subagentLoading = true; subagentError = null; subagentLive = [];
    try {
      const history = await getSubagentHistory(sessionId,id);
      if (generation === subagentGeneration && selectedSessionId === sessionId) subagentEntries = mergeSubagentEntries(history,subagentLive);
    } catch (error) { if (generation === subagentGeneration) subagentError = toErrorMessage(error); }
    finally { if (generation === subagentGeneration) subagentLoading = false; }
  }
  $effect(() => { if (subagentSelection && subagentSelection.sessionId !== selectedSessionId) { subagentOpen = false; subagentSelection = null; subagentEntries = []; ++subagentGeneration; } });

  import { AgentSettingsForm, Icon } from '$lib/ui-kit';
  import { readAgentSettings, saveAgentSettings } from './lib/api';
  import { createAgentSettingsController, type AgentSettingsState } from './lib/app/agent-settings-controller';
  import type { CapabilityScope } from '../packages/plugin-protocol/src/capability';
  let agentSettings = $state<AgentSettingsState>({target:null,snapshot:null,draft:{},loading:false,saving:false,error:null,notice:null});
  const agentSettingsController = createAgentSettingsController({read:readAgentSettings,save:saveAgentSettings,changed:state => { agentSettings = state; }});
  function configureAgent(installationId: string, contributionId: string) {
    const entry = pluginInstallations.find(item => item.id === installationId)?.contributions?.find(item => item.id === contributionId);
    const scopes = (entry?.metadata.settings as {scopes?: string[]} | undefined)?.scopes ?? [];
    const scope: CapabilityScope | null = scopes.includes('application') ? {kind:'application'}
      : scopes.includes('workspace') && selectedWorkspaceId ? {kind:'workspace',id:selectedWorkspaceId}
      : scopes.includes('session') && selectedSession?.pluginInstallationId === installationId && selectedSession.agent === contributionId ? {kind:'session',id:selectedSession.id} : null;
    if (!scope) { pluginError = '请先选择此 Agent 支持的项目或会话作用域。'; return; }
    void agentSettingsController.select({installationId,contributionId,scope});
  }
  function agentSettingsScopeLabel(scope: CapabilityScope): string {
    if (scope.kind === 'application') return '全局设置';
    if (scope.kind === 'workspace') return `项目：${workspaces.find(item => item.id === scope.id)?.label ?? '已不可用'}`;
    return `会话：${Object.values(workspaceSessionMap).flat().find(item => item.id === scope.id)?.label ?? '已不可用'}`;
  }
  function selectAgentSettingsScope(scope: CapabilityScope) {
    if (agentSettings.target) void agentSettingsController.select({...agentSettings.target,scope});
  }

  import type { GitRepositoryState } from '../packages/plugin-protocol/src/presentation-git';
  import { repositoryDraftKey, readRepositoryViews, writeRepositoryViews } from '$lib/app/git-repository-state';
  import { encodeClipboardImages } from '$lib/app/clipboard-images';
  import { registerSessionClipboardImages } from '$lib/api';
  import { listWorkspaceGitRepositories } from '$lib/api';
  import { readWorkbenchDrafts, writeWorkbenchDrafts, emptyGitPanelState } from '$lib/app/workbench-drafts';
  const draftStorage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) };
  import { readWorkbenchLayout, writeWorkbenchLayout } from '$lib/app/workbench-layout-storage';
  const savedWorkbenchLayout = readWorkbenchLayout(draftStorage, presentationWindowId());
  let workbenchDrafts = $state(readWorkbenchDrafts(draftStorage, presentationWindowId()));
  $effect(() => { writeWorkbenchDrafts(draftStorage, presentationWindowId(), workbenchDrafts); });
  import { SettingsSection, HostPanel, PresentationHost, WorkbenchPresentation, DefaultPresentationActions, Badge, Button, Card, CardHeader, CardTitle, CardContent } from '$lib/ui-kit';
  import { createPresentationPackageController, type PresentationPackageState } from '$lib/app/presentation-package-controller';
  import { listPresentationPackages, readPresentationPackage, installPresentationPackage, setPresentationPackageEnabled, uninstallPresentationPackage, getPresentationSelection, selectPresentationPackage } from '$lib/api';
  import { createCapabilityWorkbenchDirectory } from '$lib/presentation-runtime/capability-workbench';
  import type { PresentationCapabilityWorkbench } from '../packages/plugin-protocol/src/presentation-capability';
  const capabilityWorkbenchDirectory = createCapabilityWorkbenchDirectory();
  import { createProjectEditorController, emptyProjectEditor, type ProjectEditorField } from '$lib/app/project-editor-controller';
  import type { PresentationProjectEditor } from '../packages/plugin-protocol/src/presentation-inspector';
  let projectEditors = $state<Record<string, PresentationProjectEditor>>({});
  let projectRunningActions = $state<Record<string, string | null>>({});
  const projectEditor = createProjectEditorController({
    workspace: () => selectedWorkspaceId, actions: () => projectActions, save: saveProjectAction,
    changed: (id, editor) => { projectEditors = { ...projectEditors, [id]: editor }; },
    saved: (id, saved) => { if (selectedWorkspaceId === id) projectActions = projectActions.some(item => item.id === saved.id) ? projectActions.map(item => item.id === saved.id ? saved : item) : [...projectActions, saved]; },
  });
  import { createInspectorDirectory } from '$lib/presentation-runtime/inspector';
  import { createArtifactPreviewController, emptyArtifactPreview } from '$lib/app/artifact-preview-controller';
  import type { PresentationInspector } from '../packages/plugin-protocol/src/presentation-inspector';
  const inspectorDirectory = createInspectorDirectory();
  let artifactPreview = $state(emptyArtifactPreview());
  const artifactPreviewController = createArtifactPreviewController({
    read: readArtifact, currentSession: () => selectedSessionId,
    available: (sessionId, artifactId) => artifacts.some(item => item.id === artifactId && item.sessionId === sessionId && item.workspaceId === selectedWorkspaceId),
    changed: state => { artifactPreview = state; },
  });
  $effect(() => { selectedSessionId; untrack(() => artifactPreviewController.reset()); });
  $effect(() => {
    const preview = artifactPreview;
    if (preview.artifactId && !artifacts.some(item => item.id === preview.artifactId && item.sessionId === preview.sessionId)) untrack(() => artifactPreviewController.reset());
  });
  import { createGitDirectory } from '$lib/presentation-runtime/git';
  import type { PresentationGit } from '../packages/plugin-protocol/src/presentation-git';
  const gitDirectory = createGitDirectory();
  import { createConversationDirectory } from '$lib/presentation-runtime/conversation';
  import { userInputDraftKey, answeredRequest, clearRequestDrafts } from '$lib/app/user-input-drafts';
  import { createLayoutDirectory } from '$lib/presentation-runtime/layout';
  import type { PresentationConversation } from '../packages/plugin-protocol/src/presentation-conversation';
  import { readUserInputDrafts, writeUserInputDrafts } from '$lib/app/user-input-draft-storage';
  let userInputDrafts = $state<Record<string, string>>(readUserInputDrafts(draftStorage, presentationWindowId()));
  let knownUserInputKeys = new Set<string>();
  $effect(() => { writeUserInputDrafts(draftStorage, presentationWindowId(), userInputDrafts); });
  const conversationDirectory = createConversationDirectory();
  $effect(() => {
    const keys = new Set(pendingUserInputs.flatMap(request => request.questions.map(question => userInputDraftKey(request, question.id))));
    untrack(() => {
      const entries = Object.entries(userInputDrafts).filter(([key]) => !knownUserInputKeys.has(key) || keys.has(key));
      if (entries.length !== Object.keys(userInputDrafts).length) userInputDrafts = Object.fromEntries(entries);
      knownUserInputKeys = keys;
    });
  });
  import { navigationActions as externalNavigationActions, resolveNavigationIntent } from '$lib/presentation-runtime/navigation';
  import type { PresentationNavigation } from '../packages/plugin-protocol/src/presentation-navigation';
  import type { PresentationInput, PresentationIntent } from '../packages/plugin-protocol/src/presentation-runtime';
  let presentationHost: ReturnType<typeof PresentationHost>;
  let presentationPackages = $state<PresentationPackageState>({ releases: [], active: null, themeId: null, busy: false, error: '' });
  let externalInput = $state<PresentationInput>({ surface: 'workbench', context: { workspaceId: null, sessionId: null, revision: 0 }, data: null, theme: {} });
  const presentationPackagesController = createPresentationPackageController({
    list: listPresentationPackages, read: readPresentationPackage, install: installPresentationPackage,
    enable: setPresentationPackageEnabled, uninstall: uninstallPresentationPackage,
    selection: getPresentationSelection, persist: selectPresentationPackage,
    prepare: (value, theme, failure, signal) => presentationHost.prepare(value, theme, failure, signal),
    changed: state => { presentationPackages = state; },
  });
  const presentationOptions = $derived([...availableUiKits, ...presentationPackages.releases.filter(release => release.enabled).map(release => ({
    id: release.digest, label: release.manifest.displayName, description: release.manifest.version,
    defaultThemeId: release.manifest.defaultThemeId ?? '',
    themes: (release.manifest.themes ?? []).map(theme => ({ ...theme, description: '', swatches: [] })),
  }))]);
  async function presentationOperation(operation: () => Promise<unknown>) {
    try { await operation(); } catch (error) { errorMessage = toErrorMessage(error); }
  }
  async function installPresentationFromDirectory() {
    const path = await open({ directory: true, multiple: false, title: '选择皮肤插件目录' });
    if (typeof path === 'string') await presentationPackagesController.install(path);
  }
  async function choosePresentation(id: string) {
    if (!desktop) { setUiKit(id); return; }
    if (presentationPackages.releases.some(release => release.digest === id)) await presentationPackagesController.select(id);
    else { await presentationPackagesController.select(null); setUiKit(id); }
  }
  async function choosePresentationTheme(id: string) {
    if (presentationPackages.active) await presentationPackagesController.select(presentationPackages.active.release.digest, id);
    else setUiTheme(id);
  }
  const externalNavigation = $derived<PresentationNavigation>({
    agentChoices,
    workspaces: workspaceItems, sessionsByWorkspace: sessionItemsByWorkspace,
    selectedWorkspaceId, selectedSessionId, expandedWorkspaceIds, sessionsLoadingWorkspaceIds,
    busy: busy || pluginBusy, threadBusy, archivingWorkspaceId, archivingSessionId, sessionSearchOpen, sessionFilterOpen,
    sessionSearch, sessionFilter, createSessionWorkspaceId, renamingSessionId, sessionLabelDraft,
  });
  async function externalNavigationIntent(intent: PresentationIntent) {
    const action = resolveNavigationIntent(externalNavigation, externalInput.context, intent);
    if (!action) return;
    const id = action.targetId!;
    switch (action.operation) {
      case 'toggleSearch': sessionSearchOpen = !sessionSearchOpen; break;
      case 'toggleFilter': sessionFilterOpen = !sessionFilterOpen; break;
      case 'search': sessionSearch = intent.value!; break;
      case 'filter': sessionFilter = intent.value as SessionFilter; await refreshExpandedSessions(); break;
      case 'applyFilters': await refreshExpandedSessions(); break;
      case 'addWorkspace': await chooseWorkspaceDirectory(); break;
      case 'selectWorkspace': selectWorkspace(id); break;
      case 'toggleSessionCreator': toggleSessionCreator(id); break;
      case 'toggleTrust': { const workspace = workspaces.find(item => item.id === id); if (workspace) await toggleTrust(workspace); break; }
      case 'removeWorkspace': { const workspace = workspaces.find(item => item.id === id); if (workspace) await deleteWorkspace(workspace); break; }
      case 'openWorkspace': await openWorkspaceLocation(id); break;
      case 'createAgent': await createWheelSession(id, action.choiceId!); break;
      case 'selectSession': installedTool = null; selectSession(id); break;
      case 'unarchiveSession': await unarchiveSession(id); break;
      case 'archiveSession': requestArchiveSession(id); break;
      case 'syncSession': await syncCodexThread(id); break;
      case 'renameSession': beginRenameSession(id); break;
      case 'renameDraft': sessionLabelDraft = intent.value!; break;
      case 'saveRename': await saveSessionRename(); break;
      case 'cancelRename': cancelRenameSession(); break;
    }
  }
  const externalConversation = $derived<PresentationConversation>({
    workspace: selectedWorkspace, session: selectedSession, goal: codexGoal, goalBusy,
    thread: codexThreadSnapshot && { id: codexThreadSnapshot.id, turnCount: codexThreadSnapshot.turnCount },
    timeline, timelineVisibleCount, groupSystemItems: selectedSession?.capabilities.includes('session.timeline') ?? false, usage: usageValues, retryPrompt, retryReason,
    userInputRequests: selectedUserInputRequests, answerDrafts: Object.fromEntries(selectedUserInputRequests.flatMap(request => request.questions.map(question => {
      const key = userInputDraftKey(request, question.id); return [key, userInputDrafts[key] ?? ''];
    }))), queue: queueSnapshot,
    activityLabel: agentActivityLabel, compacting: contextCompacting, running: sessionRunning,
    archiving: selectedSessionArchiving, busy, attachments, executionProfile,
    modelConfiguration: modelConfigurationState(selectedSession, sessionModelCatalog, executionProfile),
    modelCatalog: sessionModelCatalog, modelCatalogLoading: sessionModelCatalogLoading, modelOverride: sessionModelOverride,
    workspacePathSuggestions, sessionSuggestions, agentCommands: visibleAgentCommands, agentCommandsLoading,
    draft: composerText, draftFailed: composerDraftFailed, tree: piTree?.sessionId === selectedSessionId ? piTree : null,
    treeOpen: piTreeOpen, treeNavigationStatus: piNavigationStatus,
  });
  async function externalConversationIntent(intent: PresentationIntent) {
    const action = conversationDirectory.resolve(externalConversation, externalInput.context, intent);
    if (!action) return;
    const [target, detail, option] = action.args;
    switch (action.operation) {
      case 'draft': composerText = intent.value!; handleComposerInput(composerText); break;
      case 'copyCode': await navigator.clipboard.writeText(action.args[2]!); notice = '代码已复制'; break;
      case 'openLink': window.open(action.args[2]!, '_blank', 'noopener,noreferrer'); break;
      case 'send': await sendPrompt(); break;
      case 'stop': await abortPrompt(); break;
      case 'retry': await retryLastPrompt(); break;
      case 'queueSteer': await queuePrompt('steer'); break;
      case 'queueFollowUp': await queuePrompt('followUp'); break;
      case 'pauseGoal': await changeGoal('pause'); break;
      case 'resumeGoal': await changeGoal('resume'); break;
      case 'clearGoal': await changeGoal('clear'); break;
      case 'clearQueue': await clearPromptQueue(); break;
      case 'removeQueuedMessage': await managePromptQueue('remove', target!); break;
      case 'sendQueuedMessage': await managePromptQueue('sendNow', target!); break;
      case 'resumeQueue': await managePromptQueue('resume'); break;
      case 'addAttachments': await chooseSessionAttachments(); break;
      case 'addDirectory': await chooseSessionAttachmentDirectory(); break;
      case 'removeAttachment': await removeAttachment(target!); break;
      case 'selectSessionReference': await selectComposerSessionReference(target!); break;
      case 'selectPath':
        composerText = composerText.replace(/(?:^|\s)@([^\s]*)$/, match => `${match.startsWith(' ') ? ' ' : ''}@${target} `);
        handleComposerInput(composerText); selectComposerWorkspacePath(target!); break;
      case 'selectCommand': {
        const command = visibleAgentCommands.find((item) => item.name === target);
        if (command) composerText = composerText.replace(/^\/([^\s]*)$/, commandComposerInsertion(command));
        handleComposerInput(composerText);
        break;
      }
      case 'loadOlder': loadOlderTimeline(); break;
      case 'openSubagent': if (target) await openSubagent(target); break;
      case 'fork': await forkSession(selectedSessionId, target ?? undefined); break;
      case 'loadModels': await loadSessionModels(); break;
      case 'selectModel': await applySessionModelConfiguration(target!, detail ?? null); break;
      case 'selectServiceTier': await applySessionServiceTier(target!); break;
      case 'selectContextWindow': await applySessionContextWindow(intent.value!, target!); break;
      case 'selectAccess': await applySessionAccess(target as SessionControlId); break;
      case 'compact': await compactCurrentSession(); break;
      case 'answer':
      case 'chooseAnswer': {
        const request = selectedUserInputRequests.find(request => request.requestId === target);
        if (request) userInputDrafts = { ...userInputDrafts, [userInputDraftKey(request, detail!)]: action.operation === 'answer' ? intent.value! : option! };
        break;
      }
      case 'submitAnswers': {
        const request = selectedUserInputRequests.find(request => request.requestId === target);
        const answers = request && answeredRequest(request, userInputDrafts);
        if (request && answers) await resolveUserInput(request, answers);
        break;
      }
      case 'cancelAnswers': await abortPrompt(); break;
      case 'openTree': openPiTree(); break;
      case 'closeTree': piTreeOpen = false; break;
      case 'refreshTree': if (selectedSessionId) await refreshPiTree(selectedSessionId); break;
      case 'selectTreeNode': requestPiTreeNavigation(target!); break;
    }
  }
  let repositoryViews = $state(readRepositoryViews(draftStorage, presentationWindowId()));
  let gitRepositories = $state<GitRepositoryState[]>([]);
  let gitRepositoriesWorkspace = $state<string | null>(null);
  let repositorySearch = $state('');
  let repositoryPickerOpen = $state(false);
  let repositoryPendingSection: 'changes' | 'history' | undefined;
  let discoveryLimited = $state(false);
  let discoveryWarnings = $state<string[]>([]);
  let repositoryScanBudget = $state(2000);
  const gitHistoryPageSize = 16;
  const repositoryId = $derived(selectedWorkspaceId ? repositoryViews[selectedWorkspaceId]?.selected ?? null : null);
  const gitDraftKey = $derived(repositoryDraftKey(selectedWorkspaceId ?? '', repositoryId));
  const visibleRepositories = $derived(gitRepositoriesWorkspace === selectedWorkspaceId ? gitRepositories : []);
  $effect(() => { writeRepositoryViews(draftStorage, presentationWindowId(), repositoryViews); });
  function toggleRepository(id: string) {
    if (!selectedWorkspaceId) return;
    const view = repositoryViews[selectedWorkspaceId] ?? { selected: null, collapsed: [] };
    repositoryViews[selectedWorkspaceId] = { ...view, collapsed: view.collapsed.includes(id) ? view.collapsed.filter(value => value !== id) : [...view.collapsed, id] };
  }
  function selectRepository(id: string | null, section?: 'changes' | 'history') {
    if (!selectedWorkspaceId || workspaceGitOperationBusy || (id !== null && !visibleRepositories.some(repo => repo.id === id))) return;
    repositoryViews[selectedWorkspaceId] = { ...repositoryViews[selectedWorkspaceId], selected: id, collapsed: repositoryViews[selectedWorkspaceId]?.collapsed ?? [] };
    ++workspaceGitMetadataRequestGeneration;
    workspaceGitBranches = []; clearWorkspaceGitHistory(); workspaceGitRemoteStatus = null; workspaceGitStashes = [];
    workspaceGitMetadataLoading = false; workspaceGitMetadataError = null;
    closeWorkspaceCommitFiles(); closeWorkspaceFileDiff();
    workspaceChanges = visibleRepositories.find(repo => repo.id === id)?.changes ?? null;
    repositoryPickerOpen = false;
    section ??= repositoryPendingSection; repositoryPendingSection = undefined;
    if (id !== null) {
      if (section) {
        const key = repositoryDraftKey(selectedWorkspaceId, id);
        workbenchDrafts.git[key] = { ...(workbenchDrafts.git[key] ?? emptyGitPanelState()), gitSection: section };
      }
      void refreshWorkspaceGitMetadata(selectedWorkspaceId);
      restoreRepositoryFile(selectedWorkspaceId, id);
    }
  }
  function restoreRepositoryFile(workspaceId: string, id: string) {
    const saved = repositoryViews[workspaceId]?.files?.[id];
    if (saved && visibleRepositories.find(repo => repo.id === id)?.changes?.files.some(file => file.path === saved.path && (saved.staged ? file.staged : file.unstaged || file.untracked || file.conflicted))) {
      void openWorkspaceFileDiff(workspaceId, saved.path, saved.staged, id);
    }
  }
  const externalGit = $derived<PresentationGit>({
    repositories: visibleRepositories, repositoryId, repositorySearch, repositoryPickerOpen,
    collapsedRepositories: repositoryViews[selectedWorkspaceId ?? '']?.collapsed ?? [], discoveryLimited, discoveryWarnings,
    workspace: selectedWorkspace, sessionId: selectedSessionId, desktop, open: sidePanelOpen, activeView: sidePanelView,
    changes: workspaceChanges, loading: workspaceChangesLoading, error: visibleRepositories.find(repo => repo.id === repositoryId)?.error ?? workspaceChangesError,
    branches: workspaceGitBranches, history: workspaceGitHistory, historyHasMore: workspaceGitHistoryHasMore,
    historyLoadingMore: workspaceGitHistoryLoadingMore, historyLoadMoreError: workspaceGitHistoryLoadMoreError,
    metadataLoading: workspaceGitMetadataLoading,
    metadataError: workspaceGitMetadataError, commitFiles: workspaceGitCommitFiles, commitFilesLoading: workspaceGitCommitFilesLoading,
    remoteStatus: workspaceGitRemoteStatus, stashes: workspaceGitStashes, operationBusy: workspaceGitOperationBusy,
    reviewBusy: workspaceGitReviewBusy,
    canRequestReview: Boolean(selectedSession?.pluginInstallationId) && selectedSession?.workspaceId === selectedWorkspaceId && !selectedSession?.archived && !sessionRunning,
    draft: workbenchDrafts.git[gitDraftKey] ?? emptyGitPanelState(),
    preview: { fileDiff: workspaceFileDiff, loading: workspaceFileDiffLoading, error: workspaceFileDiffError,
      selectedPath: workspaceFileDiffPath, staged: workspaceFileDiffStaged, contextLabel: workspaceFileDiffContextLabel },
  });
  async function externalGitIntent(intent: PresentationIntent) {
    const action = gitDirectory.resolve(externalGit, externalInput.context, intent);
    if (!action) return;
    const [target, detail] = action.args;
    const workspaceId = selectedWorkspaceId!;
    const draft = externalGit.draft;
    switch (action.operation) {
      case 'selectRepository': selectRepository(target); break;
      case 'repositorySearch': repositorySearch = intent.value!; break;
      case 'toggleRepository': toggleRepository(target!); break;
      case 'continueDiscovery': repositoryScanBudget = Math.min(repositoryScanBudget * 4, 100000); await refreshWorkspaceChanges(workspaceId); break;
      case 'repositoryDiff': await openWorkspaceFileDiff(workspaceId, detail!, action.args[2] === 'staged', target!); break;
      case 'repositoryStage': await applyWorkspaceGitAction(workspaceId, detail!, 'stage', target!); break;
      case 'repositoryUnstage': await applyWorkspaceGitAction(workspaceId, detail!, 'unstage', target!); break;
      case 'repositoryStageAll': await applyWorkspaceGitWorkspaceAction(workspaceId, 'stage_all', target!); break;
      case 'repositoryUnstageAll': await applyWorkspaceGitWorkspaceAction(workspaceId, 'unstage_all', target!); break;
      case 'togglePanel': toggleSidePanel(); break;
      case 'selectView': selectSidePanelView(target as SidePanelView); break;
      case 'selectSection':
        if (repositoryId === null) { repositoryPickerOpen = true; repositoryPendingSection = target as 'changes' | 'history'; break; }
        workbenchDrafts.git[gitDraftKey] = { ...draft, gitSection: target as 'changes' | 'history' };
        if (target === 'history' && !workspaceGitHistory.length && !workspaceGitMetadataLoading) await refreshWorkspaceGitMetadata(workspaceId); break;
      case 'refresh': await refreshWorkspaceChanges(workspaceId); break;
      case 'refreshMetadata': await refreshWorkspaceGitMetadata(workspaceId); break;
      case 'loadMoreHistory': await loadMoreWorkspaceGitHistory(workspaceId); break;
      case 'commitMessage': workbenchDrafts.git[gitDraftKey] = { ...draft, commitMessage: intent.value! }; break;
      case 'branchDraft': workbenchDrafts.git[gitDraftKey] = { ...draft, branchDraft: intent.value! }; break;
      case 'commit': await commitWorkspaceGitChanges(workspaceId, target!); break;
      case 'createBranch': await createWorkspaceBranch(workspaceId, target!); break;
      case 'checkoutBranch': await checkoutWorkspaceBranch(workspaceId, target!); break;
      case 'stageFile': await applyWorkspaceGitAction(workspaceId, target!, 'stage'); break;
      case 'unstageFile': await applyWorkspaceGitAction(workspaceId, target!, 'unstage'); break;
      case 'stageAll': await applyWorkspaceGitWorkspaceAction(workspaceId, 'stage_all'); break;
      case 'unstageAll': await applyWorkspaceGitWorkspaceAction(workspaceId, 'unstage_all'); break;
      case 'openDiff': await openWorkspaceFileDiff(workspaceId, target!, detail === 'staged'); break;
      case 'closeDiff': closeWorkspaceFileDiff(); break;
      case 'selectCommit': workbenchDrafts.git[gitDraftKey] = { ...draft, selectedCommit: target! }; await loadWorkspaceCommitFiles(workspaceId, target!); break;
      case 'loadMoreCommitFiles': await loadWorkspaceCommitFiles(workspaceId, target!, true); break;
      case 'openCommitDiff': await openWorkspaceCommitFileDiff(workspaceId, target!, detail!); break;
      case 'fetch': case 'pull': case 'push': await syncWorkspaceBranch(workspaceId, action.operation); break;
      case 'saveStash': await saveWorkspaceStash(workspaceId); break;
      case 'applyStash': await applyWorkspaceStash(workspaceId, target!); break;
      case 'requestReview': await requestWorkspaceAgentReview(workspaceId); break;
    }
  }
  async function runCurrentProjectAction(actionId: string): Promise<void> {
    const workspaceId = selectedWorkspaceId;
    const sessionId = selectedSessionId;
    if (!workspaceId || projectRunningActions[workspaceId]) return;
    projectRunningActions[workspaceId] = actionId;
    try {
      const result = await projectTaskController.run(workspaceId, actionId, sessionId);
      if (selectedWorkspaceId !== workspaceId) return;
      projectActionRuns = [result, ...projectActionRuns.filter((item) => item.id !== result.id)].slice(0, 20);
      if (sessionId && selectedSessionId === sessionId) await refreshArtifacts(sessionId);
      if (selectedWorkspaceId !== workspaceId) return;
      notice = result.status === 'rejected' ? '工程动作未执行，请查看审批结果。' : result.status === 'awaiting_approval' ? '工程动作正在等待宿主批准。' : result.status === 'running' ? '工程动作正在执行。' : result.status === 'outcome_unknown' ? '工程动作结果未知，请核对实际更改后再操作。' : result.status === 'completed' ? '工程动作已完成。' : `工程动作${result.status === 'timed_out' ? '超时' : '失败'}。`;
    } catch (error) {
      if (selectedWorkspaceId === workspaceId) errorMessage = toErrorMessage(error);
    } finally {
      projectRunningActions[workspaceId] = null;
    }
  }
  async function cancelCurrentProjectAction(runId: string): Promise<void> {
    const workspaceId = selectedWorkspaceId;
    if (!workspaceId) return;
    try {
      const requested = await cancelProjectAction(workspaceId, runId);
      if (selectedWorkspaceId === workspaceId) notice = requested ? '已请求停止，正在等待执行结束；已有更改不会自动撤销。' : '该执行已结束或不属于当前工作区。';
    } catch (error) {
      if (selectedWorkspaceId === workspaceId) errorMessage = toErrorMessage(error);
    }
  }
  async function deleteCurrentProjectAction(actionId: string): Promise<void> {
    const id = selectedWorkspaceId;
    if (!id || !projectActions.some(action => action.id === actionId && action.workspaceId === id)) return;
    try {
      await deleteProjectAction(id, actionId);
      if (selectedWorkspaceId === id) projectActions = projectActions.filter(action => action.id !== actionId);
    } catch(error) { if (selectedWorkspaceId === id) errorMessage = toErrorMessage(error); }
  }
  const externalInspector = $derived<PresentationInspector>({
    workspace: selectedWorkspace, session: selectedSession, desktop, open: sidePanelOpen, activeView: sidePanelView,
    diagnostics, workspaceCapabilities, threads: codexThreads, executionProfile, attachments, artifacts, artifactPreview,
    projectEditor: projectEditors[selectedWorkspaceId ?? ''] ?? emptyProjectEditor(), runningActionId: projectRunningActions[selectedWorkspaceId ?? ''] ?? null,
    projectActions, projectActionRuns, changeSet: turnChangeSet, checkpoints, restoreOperations, workspaceChanges,
    fileDiff: turnFileDiff, fileDiffLoading: turnFileDiffLoading, fileDiffError: turnFileDiffError,
    threadBusy, busy, running: sessionRunning, archiving: selectedSessionArchiving,
  });
  async function externalInspectorIntent(intent: PresentationIntent) {
    const action = inspectorDirectory.resolve(externalInspector, externalInput.context, intent);
    if (!action) return;
    const [target, path, detail, operation] = action.args;
    const sessionId = selectedSessionId!;
    switch (action.operation) {
      case 'newProjectAction': projectEditor.edit(null); break;
      case 'editProjectAction': projectEditor.edit(target!); break;
      case 'projectField': projectEditor.change(target as ProjectEditorField, intent.value!); break;
      case 'projectKind': projectEditor.change('kind', target!); break;
      case 'saveProjectAction': await projectEditor.save(); break;
      case 'closeProjectEditor': projectEditor.close(); break;
      case 'deleteProjectAction': await deleteCurrentProjectAction(target!); break;
      case 'runProjectAction': await runCurrentProjectAction(target!); break;
      case 'cancelProjectAction': await cancelCurrentProjectAction(target!); break;
      case 'selectView': selectSidePanelView(target as SidePanelView); break;
      case 'refresh': await refresh(); break;
      case 'syncThreads': await syncCodexThreads(); break;
      case 'toggleArtifact': await artifactPreviewController.toggle(sessionId, target!); break;
      case 'closeArtifact': artifactPreviewController.reset(); break;
      case 'showDiff': await showTurnFileDiff(sessionId, target!, path!); break;
      case 'restoreTurn': await restoreTurnChangeSet(sessionId, target!); break;
      case 'fileAction': await applyGitFileActionFromInspector(sessionId, target!, path!, detail as GitFileAction); break;
      case 'hunkAction': await applyGitHunkActionFromInspector(sessionId, target!, path!, Number(detail), operation as GitFileAction); break;
    }
  }
  const externalCapability = $derived<PresentationCapabilityWorkbench>({
    catalog: installedContributions.map(item => ({...item,available:contributionAvailable(item)})),
    selected: installedTool, scope: installedScope, view: installedWorkbenchState.snapshot && presentationPackages.active?.release.manifest.surfaces?.includes('workbench') && !presentationPackages.active.release.manifest.snapshotSchemas.includes(installedWorkbenchState.snapshot.schema)
      ? {...installedWorkbenchState,snapshot:null,error:'unsupported_presentation_snapshot'} : installedWorkbenchState,
  });
  async function externalCapabilityIntent(intent: PresentationIntent) {
    const action = capabilityWorkbenchDirectory.resolve(externalCapability, externalInput.context, intent);
    if (!action) return;
    switch(action.operation) {
      case 'open': {
        const contribution = installedContributions.find(item => item.installationId === action.args[0] && item.contributionId === action.args[1] && contributionAvailable(item));
        if (contribution) { installedTool = contribution; }
        break;
      }
      case 'close': installedTool = null; break;
      case 'reload': await installedWorkbenchController?.reload(); break;
      case 'toggleLayout': installedWorkbenchController?.toggleLayout(); break;
      case 'toggleReading': installedWorkbenchController?.toggleReading(); break;
      case 'semantic': await installedWorkbenchController?.act(JSON.parse(action.args[0]!)); break;
    }
  }
  let incompatibleCapabilityRecovery: string | null = null;
  $effect(() => {
    const manifest = presentationPackages.active?.release.manifest;
    const snapshot = installedWorkbenchState.snapshot;
    if (manifest?.surfaces?.includes('workbench') && snapshot && !manifest.snapshotSchemas.includes(snapshot.schema)) {
      const identity = JSON.stringify([presentationPackages.active?.release.digest, snapshot.schema]);
      if (incompatibleCapabilityRecovery === identity) return;
      incompatibleCapabilityRecovery = identity;
      void presentationOperation(async () => { await presentationPackagesController.select(null); notice = '皮肤不支持此能力视图格式，已恢复默认呈现。'; });
    } else incompatibleCapabilityRecovery = null;
  });
  const layoutDirectory = createLayoutDirectory();
  const externalLayout = $derived({
    navigation: { width: workspaceSidebarWidth, min: workspaceColumnMin, max: Math.max(workspaceColumnMin, maxColumnWidth('workspace')) },
    auxiliary: { width: inspectorWidth, min: inspectorColumnMin, max: Math.max(inspectorColumnMin, maxColumnWidth('inspector')) },
    auxiliaryOpen: sidePanelOpen, mode: presentationLayout === 'focus' ? 'focus' : presentationLayout === 'review' ? 'review' : 'standard', switching: presentationSwitching,
  });
  function externalIntent(intent: PresentationIntent) {
    if (intent.context.workspaceId !== selectedWorkspaceId || intent.context.sessionId !== selectedSessionId) return;
    if (intent.id.startsWith('layout:')) { const change = layoutDirectory.resolve(externalLayout, externalInput.context, intent); if (change?.kind === 'mode') void workbenchPresentation?.switchPresentation(change.mode); else if (change) setColumnWidth(change.target === 'navigation' ? 'workspace' : 'inspector', change.width); return; }
    if (intent.id.startsWith('capability:')) { void presentationOperation(() => externalCapabilityIntent(intent)); return; }
    if (intent.id.startsWith('inspector:')) { void presentationOperation(() => externalInspectorIntent(intent)); return; }
    if (intent.id.startsWith('git:')) { void presentationOperation(() => externalGitIntent(intent)); return; }
    if (intent.id.startsWith('conversation:')) { void presentationOperation(() => externalConversationIntent(intent)); return; }
    if (intent.id.startsWith('navigation:')) { void presentationOperation(() => externalNavigationIntent(intent)); return; }
    if (intent.id !== 'draft' && intent.event !== 'click') return;
    if (intent.id === 'draft' && intent.event === 'input' && typeof intent.value === 'string') { composerText = intent.value; handleComposerInput(intent.value); }
    else if (intent.id === 'send' && !busy && !sessionRunning) void sendPrompt();
    else if (intent.id === 'stop' && sessionRunning) void abortPrompt();
    else if (intent.id.startsWith('workspace:')) {
      const id = intent.id.slice('workspace:'.length);
      if (workspaces.some(workspace => workspace.id === id)) selectWorkspace(id);
    } else if (intent.id.startsWith('session:')) {
      const id = intent.id.slice('session:'.length);
      if (sessions.some(session => session.id === id && session.workspaceId === selectedWorkspaceId)) selectSession(id);
    }
  }
  $effect(() => {
    const data = { workspaces: workspaces.map(({ id, label }) => ({ id, label })),
      sessions: sessions.filter(session => session.workspaceId === selectedWorkspaceId).map(({ id, label, state }) => ({ id, label, state })),
      timeline: timeline.map(({ id, role, content, status }) => ({ id, role, content, status })),
      layout: externalLayout, layoutActions: layoutDirectory.project(externalLayout),
      capability: externalCapability,
      capabilityActions: capabilityWorkbenchDirectory.project(externalCapability),
      inspector: externalInspector, inspectorActions: inspectorDirectory.project(externalInspector),
      git: externalGit, gitActions: gitDirectory.project(externalGit),
      conversation: externalConversation, conversationActions: conversationDirectory.project(externalConversation),
      navigation: externalNavigation, navigationActions: externalNavigationActions(externalNavigation),
      draft: composerText, busy, running: sessionRunning, selectedWorkspaceId, selectedSessionId };
    untrack(() => { externalInput = { surface: 'workbench', context: { workspaceId: data.selectedWorkspaceId, sessionId: data.selectedSessionId, revision: externalInput.context.revision + 1 }, data: $state.snapshot(data), theme: {} }; });
  });
  $effect(() => {
    if (!desktop) return;
    void presentationOperation(() => presentationPackagesController.initialize());
    const timer = setInterval(() => { void presentationPackagesController.refresh(); }, 2000);
    return () => { clearInterval(timer); presentationPackagesController.dispose(); };
  });
  const loadInstalledWorkbench = () => import('$lib/workbench/InstalledWorkbench.svelte');
  import type { InstalledWorkbenchState, createInstalledWorkbenchController } from '$lib/app/installed-workbench-controller';
  let installedWorkbenchState = $state<InstalledWorkbenchState>({snapshot:null,error:'',enhanced:true,layout:'central',focusTarget:null,restoring:false});
  let installedWorkbenchController: ReturnType<typeof createInstalledWorkbenchController> | null = null;
  $effect(() => {
    const contribution = installedTool;
    const scope = installedScope;
    const workspaceId = selectedWorkspaceId ?? '';
    const available = contribution && contributionAvailable(contribution);
    let cancelled = false;
    let owned: ReturnType<typeof createInstalledWorkbenchController> | null = null;
    untrack(() => {
      installedWorkbenchState = {snapshot:null,error:'',enhanced:true,layout:'central',focusTarget:null,restoring:true};
      if (contribution && available) void import('$lib/app/installed-workbench-controller').then(module => {
        if (cancelled) return;
        owned = module.createInstalledWorkbenchController(installedPort, presentationState, state => { if (!cancelled) installedWorkbenchState = state; });
        installedWorkbenchController = owned;
        void owned.open(workspaceId, contribution, scope);
      }).catch(error => { if (!cancelled) installedWorkbenchState = {...installedWorkbenchState,restoring:false,error:toErrorMessage(error)}; });
    });
    return () => { cancelled = true; owned?.dispose(); if (installedWorkbenchController === owned) installedWorkbenchController = null; };
  });
  import { listSemanticContributions, cancelSemanticOpen, openSemanticContribution, actSemanticContribution, writeSemanticContribution, releaseSemanticContribution } from '$lib/api';
  import type { InstalledContribution, InstalledScope } from '$lib/presentation/installed-controller';
  const installedPort = { cancelOpen: cancelSemanticOpen, open: openSemanticContribution, act: actSemanticContribution, write: writeSemanticContribution, release: releaseSemanticContribution };
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
  import { onDestroy, onMount, tick, untrack } from 'svelte';
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
    PluginManagerPanel,
    toSessionListItemsByWorkspace,
    toUsageValues,
    toWorkspaceListItems,
    toolLabel,
  } from '$lib/components/app';
  import { cacheSessionUsage, usageForSession } from '$lib/app/session-usage-cache';
  import type { SessionUsageCache } from '$lib/app/session-usage-cache';
  import type { SidePanelView } from '$lib/components/app';
  import {
    readPersistedSelection as readSelectionFromStorage,
    writePersistedSelection as writeSelectionToStorage,
  } from '$lib/app/selection-storage';
  import { normalizeAgentGoal, goalCanResume } from '$lib/app/session-goal';
  import { handleAgentEvent as processAgentEvent } from '$lib/app/agent-event-handler';
  import { createExecutionHistoryController, emptyExecutionHistory } from '$lib/app/execution-history-controller';
  import { createSessionHistoryController, emptySessionHistory } from '$lib/app/session-history-controller';
  import { createCapabilityHistoryController, emptyCapabilityHistory } from '$lib/app/capability-history-controller';
  import { listCapabilityHistoryScopes, readCapabilityHistory } from '$lib/api';
  import { sessionMentionSuggestions } from '$lib/app/session-references';
  import { referenceSession } from '$lib/api';
  import { listWorkspaceWriteRuns, cancelWorkspaceWrite, readSessionHistory } from '$lib/api';
  import { createProjectTaskController, observeProjectTaskHistory } from '$lib/app/project-task-controller';
  import { createApprovalController } from '$lib/app/approval-controller';
  import { toErrorMessage } from '$lib/app/error-utils';
  import { createSessionLifecycleController } from '$lib/app/session-lifecycle-controller';
  import { createSessionContextController } from '$lib/app/session-context-controller';
  import { createRefreshController } from '$lib/app/refresh-controller';
  import { createModelConfigurationService, modelConfigurationState } from '$lib/app/model-configuration';
  import type { ModelConfigurationChange } from '$lib/app/model-configuration';
  import { listCodexThreads, readCodexThread, forkCodexThread, getPiSessionTree, navigatePiSessionTree } from '$lib/api';
  import { createAgentFacade } from '$lib/app/agent-facade';
  import { createViewStateStore } from '$lib/app/view-state-storage';
  import { createMessageController } from '$lib/app/message-controller';
  import { createNavigationController } from '$lib/app/navigation-controller';
  import { normalizeMessageQueue, newerMessageQueue } from '$lib/app/message-queue';
  import { createPiTreeController } from '$lib/app/pi-tree-controller';
  import { createWorkspaceController } from '$lib/app/workspace-controller';
  import {
    sessionBuiltinCommands,
    commandComposerInsertion,
    parseAgentCommand,
    visibleSessionCommands,
  } from '$lib/app/agent-commands';
  import { upsertSession, workspaceIdsForRefresh } from '$lib/app/session-transitions';
  import type { PersistedSelection } from '$lib/app/selection-storage';
  import {
    readComposerDrafts,
    writeComposerDrafts,
  } from '$lib/app/composer-draft-storage';
  import type { ComposerDrafts } from '$lib/app/composer-draft-storage';
  import { isSessionRunning } from '$lib/app/session-state';
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
  import { sessionProviders, readySessionProviders, sessionProviderIcon } from '$lib/app/session-providers';
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
    SessionControlId,
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
  // Confirmed catalogs belong to sessions, not the currently selected pane.
  const sessionModelCatalogs = new Map<string, SessionModelCatalog>();
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
  let previewRepositoryId = $state<string | null>(null);
  let workspaceFileDiffStaged = $state(false);
  let workspaceFileDiffContextLabel = $state<string | null>(null);
  let workspaceFileDiffRequestGeneration = 0;
  let workspaceGitCommitBusy = $state(false);
  let workspaceGitBranches = $state<GitBranch[]>([]);
  let workspaceGitHistory = $state<GitCommit[]>([]);
  let workspaceGitHistoryHasMore = $state(false);
  let workspaceGitHistoryLoadingMore = $state(false);
  let workspaceGitHistoryLoadMoreError = $state<string | null>(null);
  let workspaceGitHistoryNextOffset = 0;
  let workspaceGitMetadataLoading = $state(false);
  let workspaceGitMetadataError = $state<string | null>(null);
  let workspaceGitMetadataRequestGeneration = 0;
  let workspaceGitMetadataBackgroundRefreshing = false;
  function clearWorkspaceGitHistory(): void {
    workspaceGitHistory = [];
    workspaceGitHistoryHasMore = false;
    workspaceGitHistoryLoadingMore = false;
    workspaceGitHistoryLoadMoreError = null;
    workspaceGitHistoryNextOffset = 0;
  }
  let workspaceGitCommitFiles = $state<GitCommitFileList | null>(null);
  let workspaceGitCommitFilesLoading = $state(false);
  let workspaceGitCommitFilesRequestGeneration = 0;
  let workspaceGitRemoteStatus = $state<GitRemoteStatus | null>(null);
  let workspaceGitStashes = $state<GitStashEntry[]>([]);
  let workspaceGitSyncBusy = $state(false);
  let workspaceGitReviewBusy = $state(false);
  let turnFileDiff = $state<TurnFileDiff | null>(null);
  let turnFileDiffLoading = $state(false);
  let turnFileDiffError = $state<string | null>(null);
  let turnFileDiffGeneration = 0;
  $effect(() => {
    selectedSessionId; turnChangeSet?.turnId;
    untrack(() => { ++turnFileDiffGeneration; turnFileDiff = null; turnFileDiffLoading = false; turnFileDiffError = null; });
  });
  let attachments = $state<ContextAttachment[]>([]);
  let attachmentPreviews = $state<Record<string, string | null>>({});
  const previewController = createAttachmentPreviews(getSessionAttachmentPreview, values => { attachmentPreviews = values; });
  $effect(() => { previewController.update(desktop ? selectedSessionId : null, attachments); });
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
  let sessionSuggestions = $state<Session[]>([]);
  let agentCommands = $state<AgentCommand[]>([]);
  let agentCommandsLoading = $state(false);
  let pathSearchGeneration = 0;
  let pathSearchTimer: ReturnType<typeof setTimeout> | undefined;

  const workspaceGitOperationBusy = $derived(
    workspaceGitBusyPath !== null || workspaceGitCommitBusy || workspaceGitSyncBusy,
  );

  function resetWorkspaceGitView(): void {
    ++workspaceChangesRequestGeneration;
    repositorySearch = ''; discoveryLimited = false; discoveryWarnings = []; repositoryScanBudget = 2000;
    workspaceChanges = null;
    workspaceChangesLoading = false;
    workspaceChangesError = null;
    closeWorkspaceFileDiff();
    ++workspaceGitMetadataRequestGeneration;
    workspaceGitBranches = [];
    clearWorkspaceGitHistory();
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
    return visibleSessionCommands(sessionBuiltinCommands(selectedSession, executionProfile?.sessionId === selectedSession.id ? executionProfile.sessionControls : []), agentCommands);
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
  let usageSnapshotsBySession = $state<SessionUsageCache>({});
  let retryPrompt = $state<string | null>(null);
  let retryReason = $state<string | null>(null);
  let lastSubmittedPrompt = $state<string | null>(null);
  let settingsOpen = $state(false);
  let workspacePreferences = $state(emptyWorkspacePreferences());
  const workspacePreferencesController = createWorkspacePreferencesController({
    read: readWorkspacePreferences, save: saveWorkspacePreferences,
    changed: value => { workspacePreferences = value; },
  });
  $effect(() => {
    if (settingsOpen && desktop) untrack(() => { void workspacePreferencesController.load(); });
  });
  let managementSection = $state<'appearance' | 'extensions' | 'runtime'>('appearance');
  const listSessions: typeof listAllSessions = listAllSessions;
  let historyOpen = $state(false);
  let historyWorkspaceId = $state<string | null>(null);
  let executionHistory = $state(emptyExecutionHistory());
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
    settingsOpen = false; commandPaletteOpen = false;
    historyWorkspaceId = selectedWorkspaceId ?? workspaces[0]?.id ?? null;
    historyOpen = true;
  }
  function closeHostPanel(): void { historyOpen = false; capabilityHistoryOpen = false; }
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
    historyOpen = false; settingsOpen = false; commandPaletteOpen = false;
    sessionHistoryWorkspaceId = selectedWorkspaceId ?? workspaces[0]?.id ?? null;
    sessionHistoryOpen = true;
  }
  async function closeSessionHistory(): Promise<void> {
    sessionHistoryOpen = false;
    await tick();
    const trigger = sessionHistoryTrigger?.isConnected ? sessionHistoryTrigger : document.querySelector<HTMLElement>('[aria-label="会话历史"]') ?? document.querySelector<HTMLElement>('[aria-label="打开设置"]');
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
  function openCapabilityHistory():void { historyOpen=true;sessionHistoryOpen=false;settingsOpen=false;capabilityHistoryOpen=true; }
  function backFromCapabilityHistory():void { capabilityHistoryOpen=false;historyOpen=true; }

  let pluginInstallations = $state<PluginInstallation[]>([]);
  const agentChoices = $derived(readySessionProviders(pluginInstallations));
  let pluginRefreshRevision = 0;
  async function refreshPluginInstallations(): Promise<void> {
    if (!desktop) return;
    const revision = ++pluginRefreshRevision;
    const installations = await listPluginInstallations();
    if (revision === pluginRefreshRevision) pluginInstallations = installations;
  }
  $effect(() => {
    if (!desktop) return;
    const refresh = () => { void refreshPluginInstallations().catch(error => { pluginError = toErrorMessage(error); }); };
    refresh();
    const timer = window.setInterval(() => { if (createSessionWorkspaceId && document.visibilityState === 'visible') refresh(); }, 5000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); ++pluginRefreshRevision; };
  });
  const pluginManagerInstallations = $derived(pluginInstallations.map(installation => ({ ...installation, sessionProviders: sessionProviders(installation) })));
  let pluginBusy = $state(false);
  let pluginError = $state('');

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

  function openManagementCenter(section: 'appearance' | 'extensions' | 'runtime' = 'appearance'): void {
    capabilityHistoryOpen = false;
    sessionHistoryOpen = false;
    historyOpen = false;
    commandPaletteOpen = false;
    installedTool = null;
    managementSection = section;
    settingsOpen = true;
    if (section === 'extensions') void pluginOperation(refreshPluginInstallations);
  }

  async function installPlugin(): Promise<void> {
    await pluginOperation(async () => {
      const path = await open({ directory: true, multiple: false, title: '选择能力插件目录' });
      if (typeof path !== 'string') return;
      await installAgentPlugin(path);
      await refreshPluginInstallations();
    });
  }

  async function enablePlugin(id: string, enabled: boolean): Promise<void> {
    await pluginOperation(async () => {
      await setAgentPluginEnabled(id, enabled);
      await refreshPluginInstallations();
    });
  }

  async function uninstallPlugin(id: string): Promise<void> {
    await pluginOperation(async () => {
      await uninstallAgentPlugin(id);
      await refreshPluginInstallations();
      if (selectedWorkspaceId) await refreshSessions(selectedWorkspaceId);
    });
  }

  async function createPluginSession(installationId: string, agentId: string, workspaceId = selectedWorkspaceId): Promise<void> {
    if (!workspaceId) { pluginError = '请先选择工作区。'; return; }
    await pluginOperation(async () => {
      const session = await createAgentSession(workspaceId, agentId, installationId);
      workspaceSessionMap = upsertSession(workspaceSessionMap, session);
      if (selectedWorkspaceId === workspaceId) {
        navigationController.selectSession(session.id);
        settingsOpen = false;
        createSessionWorkspaceId = null;
      }
    });
  }

  async function createWheelSession(workspaceId: string, choiceId: string): Promise<void> {
    if (busy || pluginBusy || !workspaces.some(workspace => workspace.id === workspaceId)) return;
    const choice = agentChoices.find(choice => choice.id === choiceId);
    if (!choice) return;
    if (workspaceId !== selectedWorkspaceId) activateWorkspace(workspaceId);
    await createPluginSession(choice.installationId, choice.contributionId, workspaceId);
    errorMessage = pluginError;
  }

  const managementNeedsAttention = $derived(
    diagnostics.some(agent => agent.status !== 'ready')
      || pluginInstallations.some(installation => !installation.runnable || (installation.activationIssues?.length ?? 0) > 0)
  );

  $effect(() => {
    if (!settingsOpen || managementSection !== 'extensions' || !desktop) return;
    untrack(() => { void pluginOperation(refreshPluginInstallations); });
  });
  let sidePanelOpen = $state(savedWorkbenchLayout.auxiliaryOpen);
  let sidePanelView = $state<SidePanelView>(savedWorkbenchLayout.activeView);
  const inspectorOpen = $derived(sidePanelOpen);
  let workspaceSidebarWidth = $state(savedWorkbenchLayout.navigationWidth);
  let inspectorWidth = $state(savedWorkbenchLayout.auxiliaryWidth);
  let viewportWidth = $state(1280);
  let workspaceGridElement = $state<HTMLElement | null>(null);
  $effect(() => { writeWorkbenchLayout(draftStorage, presentationWindowId(), { navigationWidth: workspaceSidebarWidth, auxiliaryWidth: inspectorWidth, auxiliaryOpen: sidePanelOpen, activeView: sidePanelView }); });
  $effect(() => {
    const width = viewportWidth; sidePanelOpen;
    untrack(() => { if (width >= 700) { setColumnWidth('workspace', workspaceSidebarWidth); setColumnWidth('inspector', inspectorWidth); } });
  });
  type ColumnResizeTarget = 'workspace' | 'inspector';
  type ColumnResizeState = {
    target: ColumnResizeTarget;
    startX: number;
    startWidth: number;
    growthDirection: 1 | -1;
  };
  let columnResizeState: ColumnResizeState | null = null;
  $effect(() => { workspaceGridElement; untrack(endColumnResize); });
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
    openManagementCenter('appearance');
  }

  function openDiagnosticsPanel(): void {
    openManagementCenter('runtime');
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
    const availableWidth = viewportWidth;
    const totalWidth = workspaceGridElement?.clientWidth || availableWidth;
    const splitterWidth = splitterTrackWidth * (sidePanelOpen ? 2 : 1);
    const otherColumnWidth = target === 'workspace' ? (sidePanelOpen ? inspectorWidth : 0) : workspaceSidebarWidth;
    return Math.min(4096, totalWidth - splitterWidth - otherColumnWidth - timelineColumnMin);
  }

  function setColumnWidth(target: ColumnResizeTarget, value: number): void {
    if (target === 'workspace') {
      workspaceSidebarWidth = clampColumnWidth(value, workspaceColumnMin, maxColumnWidth(target));
    } else {
      inspectorWidth = clampColumnWidth(value, inspectorColumnMin, maxColumnWidth(target));
    }
  }

  function beginColumnResize(target: ColumnResizeTarget, event: PointerEvent, growthDirection: 1 | -1): void {
    if (event.button !== 0 || !workspaceGridElement) return;
    event.preventDefault();
    columnResizeState = {
      target,
      startX: event.clientX,
      growthDirection,
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
    const width = state.startWidth + delta * state.growthDirection;
    setColumnWidth(state.target, width);
  }

  function endColumnResize(): void {
    columnResizeState = null;
    window.removeEventListener('pointermove', handleColumnResize);
    window.removeEventListener('pointerup', endColumnResize);
    window.removeEventListener('pointercancel', endColumnResize);
  }

  function handleSplitterKeydown(target: ColumnResizeTarget, event: KeyboardEvent, growthDirection: 1 | -1): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const delta = direction * growthDirection;
    const currentWidth = target === 'workspace' ? workspaceSidebarWidth : inspectorWidth;
    setColumnWidth(target, currentWidth + delta * 16);
  }

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const sessions = $derived(workspaceSessionMap[selectedWorkspaceId ?? ''] ?? []);

  const workspaceItems = $derived<WorkspaceListItem[]>(toWorkspaceListItems(workspaces));

  const sessionItemsByWorkspace = $derived(
    toSessionListItemsByWorkspace(workspaceSessionMap, pluginInstallations),
  );

  const usageValues = $derived(toUsageValues(usageForSession(usageSnapshotsBySession, selectedSessionId)));
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

  let goalRequestGeneration = 0;
  let goalBusy = $state(false);
  async function refreshGoal() {
    if (goalBusy) return;
    const session = selectedSession;
    const generation = ++goalRequestGeneration;
    if (!desktop || !session?.capabilities.includes('goal.manage') || session.archived) {
      codexGoal = null;
      return;
    }
    try {
      const value = await agentFacade.invoke(session, 'goal.manage', { action: 'get' });
      if (generation === goalRequestGeneration && selectedSessionId === session.id) codexGoal = normalizeAgentGoal(value);
    } catch {
      // A transient refresh failure must not erase a known goal.
    }
  }
  async function changeGoal(action: 'clear' | 'pause' | 'resume') {
    const session = selectedSession;
    if (!session?.capabilities.includes('goal.manage') || session.archived || selectedSessionArchiving || goalBusy) return;
    if (action === 'resume' && (!session.capabilities.includes('goal.resume') || sessionRunning || !goalCanResume(codexGoal))) return;
    if (action === 'pause' && (!session.capabilities.includes('goal.pause') || !codexGoal || !['active','paused'].includes(codexGoal.status))) return;
    if (action === 'clear' && sessionRunning) return;
    goalBusy = true;
    ++goalRequestGeneration;
    try {
      const result = await agentFacade.invoke(session, action === 'resume' ? 'goal.resume' : 'goal.manage', action === 'resume' ? {} : { action });
      if (selectedSessionId === session.id && action !== 'resume') codexGoal = normalizeAgentGoal(result);
      await refreshSessions(session.workspaceId);
      if (selectedSessionId === session.id) await refreshTimeline(session.id);
    } catch (error) { errorMessage = toErrorMessage(error); }
    finally { goalBusy = false; if (selectedSessionId === session.id) void refreshGoal(); }
  }
  $effect(() => {
    const id = selectedSessionId;
    codexGoal = null;
    untrack(() => { void refreshGoal(); });
    const timer = setInterval(() => { if (!goalBusy) void refreshGoal(); }, 5000);
    return () => { clearInterval(timer); ++goalRequestGeneration; };
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
    // Historical streaming rows do not establish live execution.
    if (
      !sessionRunning &&
      !promptInFlight &&
      !activeAgentSession
    ) return null;
    if (selectedSession.state === 'waiting_approval' || selectedApprovals.length > 0) {
      return withActivityAge('等待你的确认…');
    }
    if (selectedSession.state === 'waiting_user' || selectedUserInputRequests.length > 0) {
      return withActivityAge('等待你的输入…');
    }
    if (selectedSession.state === 'compacting') return withActivityAge('正在压缩上下文…');
    const agentLabel = selectedSession?.label ?? 'Agent';
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

  let workbenchPresentation: { switchPresentation: (layout: string) => Promise<void>; restoreDefault: () => Promise<void> } | undefined = $state();
  let presentationLayout = $state('standard');
  let presentationSwitching = $state(false);

  const commandPaletteCommands = $derived.by((): CommandPaletteCommand[] => [
    { id: 'focus-presentation', label: '切换专注会话', description: '显示或收起工作台侧边区域', run: () => { void workbenchPresentation?.switchPresentation(presentationLayout === 'focus' ? 'standard' : 'focus'); } },
    { id: 'restore-presentation', label: '恢复默认呈现', description: '恢复标准工作台布局', shortcut: '⌘⇧⌫', run: () => { void workbenchPresentation?.restoreDefault(); } },
    { id: 'execution-history', label: '执行历史', description: '查看执行记录', run: openExecutionHistory },
    { id: 'session-history', label: '会话历史', description: '查找与恢复历史会话', run: openSessionHistory },
    ...installedContributions.map(item => ({ id: `installed:${item.installationId}:${item.contributionId}`, label: item.title, description: item.issue ?? '已安装的插件视图', disabled: !contributionAvailable(item),
      run: () => { installedTool = item; settingsOpen = false; commandPaletteOpen = false; } })),
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
      label: '打开管理中心',
      description: '外观、扩展与运行状态',
      shortcut: '⌘,',
      run: openSettingsPanel,
    },
    {
      id: 'extensions',
      label: '管理扩展',
      description: '安装、启用或移除插件',
      run: () => openManagementCenter('extensions'),
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
      id: 'clear-message-queue',
      label: '清空待处理队列',
      description: '移除当前会话中尚未发送的消息',
      disabled: !selectedSession?.capabilities.includes('queue.manage')
        || queueSnapshot === null
        || (queueSnapshot.steering.length === 0 && queueSnapshot.followUp.length === 0)
        || busy,
      run: () => void clearPromptQueue(),
    },
  ]);

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const key = event.key.toLocaleLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && key === 'k') {
      event.preventDefault();
      commandPaletteOpen = !commandPaletteOpen;
      return;
    }

    if (commandPaletteOpen) {
      if (key === 'escape') { event.preventDefault(); commandPaletteOpen = false; }
      return;
    }
    if ((historyOpen || capabilityHistoryOpen) && !settingsOpen) {
      if (key === 'escape') { event.preventDefault(); closeHostPanel(); }
      return;
    }
    if (sessionHistoryOpen && !settingsOpen) {
      if (key === 'escape') { event.preventDefault(); closeSessionHistory(); }
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
      if (settingsOpen) {
        event.preventDefault();
        settingsOpen = false;
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
    retryPrompt = null;
    retryReason = null;
    lastSubmittedPrompt = null;
    workspacePathSuggestions = [];
    sessionSuggestions = [];
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
    sessionSuggestions = [];
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
    const targetSessionId = selectedSession.id;
    const generation = ++pathSearchGeneration;
    if (pathSearchTimer) clearTimeout(pathSearchTimer);
    pathSearchTimer = setTimeout(() => {
      pathSearchTimer = undefined;
      void listAllSessions(workspaceId, { statusFilter: 'all' }).then(sessions => {
        if (generation === pathSearchGeneration && selectedSessionId === targetSessionId) {
          sessionSuggestions = sessionMentionSuggestions(sessions, workspaceId, targetSessionId, query);
        }
      }).catch(() => {
        if (generation === pathSearchGeneration) sessionSuggestions = [];
      });
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

  async function selectComposerSessionReference(sourceSessionId: string): Promise<void> {
    const session = selectedSession;
    if (!session || !desktop || busy || session.archived) return;
    const draft = composerText;
    busy = true;
    errorMessage = null;
    try {
      const attachment = await referenceSession(session.id, sourceSessionId);
      if (selectedSessionId !== session.id) return;
      attachments = [...attachments, attachment];
      if (composerText === draft) {
        composerText = draft.replace(/(^|\s)@([^\s]*)$/, '$1');
        handleComposerInput(composerText);
      }
      notice = '已添加会话引用：将传递对话摘录，不包含工具输出正文。';
    } catch (error) { errorMessage = toErrorMessage(error); }
    finally { busy = false; }
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
    if (workspaceId !== selectedWorkspaceId) return;
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
      const discovery = await listWorkspaceGitRepositories(workspaceId, repositoryScanBudget);
      if (generation !== workspaceChangesRequestGeneration || workspaceId !== selectedWorkspaceId) return;
      discoveryLimited = discovery.limited; discoveryWarnings = discovery.warnings;
      const restoringWorkspace = gitRepositoriesWorkspace !== workspaceId;
      const previous = gitRepositoriesWorkspace === workspaceId ? gitRepositories : [];
      gitRepositoriesWorkspace = workspaceId;
      gitRepositories = discovery.repositories.map(repo => ({ ...repo, changes: previous.find(old => old.id === repo.id)?.changes ?? null, error: null }));
      const remembered = repositoryViews[workspaceId];
      const next = remembered && (remembered.selected === null || gitRepositories.some(repo => repo.id === remembered.selected))
        ? remembered.selected : gitRepositories.length === 1 ? gitRepositories[0].id : null;
      if (!remembered || next !== remembered.selected) {
        repositoryViews[workspaceId] = { ...remembered, selected: next, collapsed: remembered?.collapsed ?? [] };
        ++workspaceGitMetadataRequestGeneration;
        workspaceGitBranches = []; clearWorkspaceGitHistory(); workspaceGitRemoteStatus = null; workspaceGitStashes = [];
        closeWorkspaceCommitFiles(); closeWorkspaceFileDiff();
      }
      workspaceChanges = gitRepositories.find(repo => repo.id === repositoryId)?.changes ?? null;
      // Publish discovery immediately; each repository settles independently.
      const pendingRepositories = [...gitRepositories];
      for (let offset = 0; offset < pendingRepositories.length; offset += 4) {
        if (generation !== workspaceChangesRequestGeneration || workspaceId !== selectedWorkspaceId) break;
        await Promise.all(pendingRepositories.slice(offset, offset + 4).map(async repo => {
        let changes: WorkspaceChanges | null = null; let error: string | null = null;
        try { changes = await getWorkspaceChanges(workspaceId, repo.id); } catch (failure) { error = toErrorMessage(failure); }
        if (generation !== workspaceChangesRequestGeneration || workspaceId !== selectedWorkspaceId) return;
        gitRepositories = gitRepositories.map(current => current.id === repo.id ? { ...current, changes, error } : current);
        workspaceChanges = gitRepositories.find(current => current.id === repositoryId)?.changes ?? null;
        }));
      }
      if (generation === workspaceChangesRequestGeneration && workspaceId === selectedWorkspaceId && repositoryId !== null) {
        if (!background) void refreshWorkspaceGitMetadata(workspaceId);
        if (restoringWorkspace) restoreRepositoryFile(workspaceId, repositoryId);
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
    explicitRepository?: string,
  ): Promise<void> {
    const targetRepository = explicitRepository ?? repositoryId ?? undefined;

    if (targetRepository) {
      const view = repositoryViews[workspaceId] ?? { selected: null, collapsed: [] };
      repositoryViews[workspaceId] = { ...view, files: { ...view.files, [targetRepository]: { path, staged } } };
    }
    const generation = ++workspaceFileDiffRequestGeneration;
    previewRepositoryId = targetRepository ?? null;
    workspaceFileDiffPath = path;
    workspaceFileDiffStaged = staged;
    workspaceFileDiffContextLabel = `${visibleRepositories.find(repo => repo.id === targetRepository)?.name ?? ''} · ${path}`;
    workspaceFileDiff = null;
    workspaceFileDiffLoading = true;
    workspaceFileDiffError = null;
    try {
      const diff = await getWorkspaceFileDiff(workspaceId, path, staged, targetRepository);
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
    previewRepositoryId = null;
    workspaceFileDiffStaged = false;
    workspaceFileDiffContextLabel = null;
    workspaceFileDiffError = null;
    workspaceFileDiffLoading = false;
  }

  async function refreshWorkspaceGitMetadata(workspaceId: string, background = false): Promise<void> {
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (background && (workspaceGitMetadataLoading || workspaceGitMetadataBackgroundRefreshing || workspaceGitHistoryLoadingMore)) return;
    if (background) workspaceGitMetadataBackgroundRefreshing = true;
    const generation = ++workspaceGitMetadataRequestGeneration;
    if (!background) { workspaceGitMetadataLoading = true; workspaceGitHistoryLoadingMore = false; }
    workspaceGitMetadataError = null;
    workspaceGitHistoryLoadMoreError = null;
    try {
      const [branches, historyPage, remoteStatus, stashes] = await Promise.all([
        listWorkspaceGitBranches(workspaceId, targetRepository),
        listWorkspaceGitHistory(workspaceId, gitHistoryPageSize + 1, targetRepository),
        getWorkspaceGitRemoteStatus(workspaceId, targetRepository),
        listWorkspaceGitStashes(workspaceId, targetRepository),
      ]);
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) {
        workspaceGitBranches = branches;
        const newest = historyPage.slice(0, gitHistoryPageSize);
        const boundary = newest.at(-1)?.hash;
        const previousBoundary = boundary && historyPage.length > gitHistoryPageSize && workspaceGitHistory.length > gitHistoryPageSize
          ? workspaceGitHistory.findIndex(commit => commit.hash === boundary) : -1;
        if (previousBoundary >= 0) {
          workspaceGitHistory = [...newest, ...workspaceGitHistory.slice(previousBoundary + 1)];
        } else {
          workspaceGitHistory = newest;
          workspaceGitHistoryHasMore = historyPage.length > gitHistoryPageSize;
        }
        workspaceGitHistoryNextOffset = workspaceGitHistory.length;
        workspaceGitRemoteStatus = remoteStatus;
        workspaceGitStashes = stashes;
      }
    } catch (error) {
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) {
        if (!background) workspaceGitMetadataError = toErrorMessage(error);
      }
    } finally {
      if (generation === workspaceGitMetadataRequestGeneration && !background) workspaceGitMetadataLoading = false;
      if (background) workspaceGitMetadataBackgroundRefreshing = false;
    }
  }

  async function loadMoreWorkspaceGitHistory(workspaceId: string): Promise<void> {
    const targetRepository = repositoryId;
    if (!targetRepository || !workspaceGitHistoryHasMore || workspaceGitHistoryLoadingMore || workspaceGitMetadataLoading) return;
    const generation = ++workspaceGitMetadataRequestGeneration;
    const offset = workspaceGitHistoryNextOffset;
    workspaceGitHistoryLoadingMore = true;
    workspaceGitHistoryLoadMoreError = null;
    try {
      const page = await listWorkspaceGitHistory(workspaceId, gitHistoryPageSize + 1, targetRepository, offset);
      if (generation !== workspaceGitMetadataRequestGeneration || workspaceId !== selectedWorkspaceId || targetRepository !== repositoryId) return;
      const next = page.slice(0, gitHistoryPageSize);
      const seen = new Set(workspaceGitHistory.map(commit => commit.hash));
      workspaceGitHistory = [...workspaceGitHistory, ...next.filter(commit => !seen.has(commit.hash))];
      workspaceGitHistoryNextOffset = offset + next.length;
      workspaceGitHistoryHasMore = page.length > gitHistoryPageSize;
    } catch (error) {
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId)
        workspaceGitHistoryLoadMoreError = toErrorMessage(error);
    } finally {
      if (generation === workspaceGitMetadataRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId)
        workspaceGitHistoryLoadingMore = false;
    }
  }

  async function checkoutWorkspaceBranch(workspaceId: string, branch: string): Promise<void> {
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await checkoutWorkspaceGitBranch(workspaceId, branch, undefined, targetRepository);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      notice = `已切换到 ${branch}。`;
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
      if (workspaceId === selectedWorkspaceId && targetRepository === repositoryId) closeWorkspaceFileDiff();
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function createWorkspaceBranch(workspaceId: string, branch: string): Promise<void> {
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await createWorkspaceGitBranch(workspaceId, branch, undefined, targetRepository);
      if (!result.applied) {
        errorMessage = result.message;
        return;
      }
      const draft = workbenchDrafts.git[repositoryDraftKey(workspaceId, targetRepository ?? null)];
      if (draft?.branchDraft.trim() === branch.trim()) workbenchDrafts.git[repositoryDraftKey(workspaceId, targetRepository ?? null)] = { ...draft, branchDraft: '' };
      notice = `已创建并切换到 ${branch}。`;
      await Promise.all([refreshWorkspaceChanges(workspaceId), refreshWorkspaceGitMetadata(workspaceId)]);
      if (workspaceId === selectedWorkspaceId && targetRepository === repositoryId) closeWorkspaceFileDiff();
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      workspaceGitBusyPath = null;
    }
  }

  async function syncWorkspaceBranch(workspaceId: string, action: GitSyncAction): Promise<void> {
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await syncWorkspaceGit(workspaceId, action, undefined, targetRepository);
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
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await stashWorkspaceGit(workspaceId, undefined, undefined, targetRepository);
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
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitSyncBusy = true;
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitStash(workspaceId, reference, undefined, targetRepository);
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
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return;

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
      approvalReviewer: 'none',
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
          const result = await getWorkspaceFileDiff(workspaceId, file.path, staged, targetRepository);
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
    const targetRepository = repositoryId ?? undefined;

    const generation = ++workspaceGitCommitFilesRequestGeneration;
    workspaceGitCommitFilesLoading = true;
    workspaceGitMetadataError = null;
    const offset = append && workspaceGitCommitFiles?.commit === commit ? workspaceGitCommitFiles.files.length : 0;
    if (!append) workspaceGitCommitFiles = null;
    try {
      const result = await listWorkspaceGitCommitFiles(workspaceId, commit, offset, 10, targetRepository);
      if (generation === workspaceGitCommitFilesRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) {
        workspaceGitCommitFiles = append && workspaceGitCommitFiles?.commit === commit
          ? { ...result, files: [...workspaceGitCommitFiles.files, ...result.files] }
          : result;
      }
    } catch (error) {
      if (generation === workspaceGitCommitFilesRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) {
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
    const targetRepository = repositoryId ?? undefined;

    const generation = ++workspaceFileDiffRequestGeneration;
    previewRepositoryId = targetRepository ?? null;
    workspaceFileDiffPath = path;
    workspaceFileDiffStaged = false;
    workspaceFileDiffContextLabel = `${visibleRepositories.find(repo => repo.id === targetRepository)?.name ?? ''} · 提交 ${commit.slice(0, 8)} · ${path}`;
    workspaceFileDiff = null;
    workspaceFileDiffLoading = true;
    workspaceFileDiffError = null;
    try {
      const diff = await getWorkspaceGitCommitFileDiff(workspaceId, commit, path, targetRepository);
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) workspaceFileDiff = diff;
    } catch (error) {
      if (generation === workspaceFileDiffRequestGeneration && workspaceId === selectedWorkspaceId && targetRepository === repositoryId) workspaceFileDiffError = toErrorMessage(error);
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
    explicitRepository?: string,
  ): Promise<void> {
    const targetRepository = explicitRepository ?? repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = path;
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitFileAction(workspaceId, path, action, undefined, targetRepository);
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
    explicitRepository?: string,
  ): Promise<void> {
    const targetRepository = explicitRepository ?? repositoryId ?? undefined;
    if (!targetRepository) return;

    if (workspaceGitOperationBusy) return;
    workspaceGitBusyPath = '*';
    errorMessage = null;
    try {
      const result = await applyWorkspaceGitActionApi(workspaceId, action, undefined, targetRepository);
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
    const targetRepository = repositoryId ?? undefined;
    if (!targetRepository) return false;

    if (workspaceGitOperationBusy) return false;
    workspaceGitCommitBusy = true;
    errorMessage = null;
    try {
      const result = await commitWorkspaceChanges(workspaceId, message, undefined, targetRepository);
      if (!result.committed) {
        errorMessage = result.message;
        return false;
      }
      const draft = workbenchDrafts.git[repositoryDraftKey(workspaceId, targetRepository ?? null)];
      if (draft?.commitMessage.trim() === message.trim()) workbenchDrafts.git[repositoryDraftKey(workspaceId, targetRepository ?? null)] = { ...draft, commitMessage: '' };
      notice = result.hash ? `已创建提交 ${result.hash.slice(0, 8)}。` : '已创建提交。';
      await refreshWorkspaceChanges(workspaceId);
      await refreshWorkspaceGitMetadata(workspaceId);
      if (workspaceId === selectedWorkspaceId && targetRepository === repositoryId) closeWorkspaceFileDiff();
      return true;
    } catch (error) {
      errorMessage = toErrorMessage(error);
      return false;
    } finally {
      workspaceGitCommitBusy = false;
    }
  }

  async function pasteComposerImages(files: File[]) {
    const session = selectedSession;
    if (!desktop || !session || session.archived || selectedSessionArchiving || busy) return;
    busy = true;
    try {
      const images = await encodeClipboardImages(files);
      const registered = await registerSessionClipboardImages(session.id, images);
      if (selectedSessionId === session.id) {
        attachments = [...attachments, ...registered];
        notice = `已添加 ${registered.length} 张图片。`;
      }
    } catch (error) {
      if (selectedSessionId === session.id) errorMessage = toErrorMessage(error);
    } finally { busy = false; }
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
    if (selectedSessionId !== sessionId || turnChangeSet?.turnId !== turnId || !turnChangeSet.files.some(file => file.path === path)) return;
    const owner = ++turnFileDiffGeneration;
    const owns = () => owner === turnFileDiffGeneration && selectedSessionId === sessionId && turnChangeSet?.turnId === turnId;
    turnFileDiff = null; turnFileDiffError = null; turnFileDiffLoading = true;
    try {
      const diff = await getTurnFileDiff(sessionId, turnId, path);
      if (!owns()) return;
      if (diff.path !== path) throw Error('turn_diff_identity_mismatch');
      turnFileDiff = diff;
    } catch (error) {
      if (owns()) { turnFileDiffError = toErrorMessage(error); errorMessage = turnFileDiffError; }
    } finally {
      if (owns()) turnFileDiffLoading = false;
    }
  }

  async function applyGitFileActionFromInspector(sessionId: string, turnId: string, path: string, action: GitFileAction) {
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
    if (event.type === 'subagent.message' && event.sessionId === subagentSelection?.sessionId && event.payload.agentId === subagentSelection.id) {
      const entry = event.payload.entry as SubagentEntry;
      if (entry && typeof entry.id === 'string' && typeof entry.content === 'string') {
        subagentEntries = mergeSubagentEntries(subagentEntries,[entry]);
        if (subagentLoading) subagentLive = mergeSubagentEntries(subagentLive,[entry]);
      }
    }
    if (event.sessionId === selectedSessionId && event.type === 'goal.updated') {
      ++goalRequestGeneration;
      codexGoal = normalizeAgentGoal(event.payload);
    }
    if (event.sessionId === selectedSessionId && ['turn.completed', 'turn.failed', 'session.state_changed'].includes(event.type)) void refreshGoal();
    processAgentEvent(event, {
      selectedSessionId,
      selectedAgent: selectedSession?.label ?? null,
      timeline,
      pendingApprovals,
      pendingUserInputs,
      lastSubmittedPrompt,
      setAgentActivity,
      updateWorkspaceSessions,
      setPendingApprovals: (approvals) => (pendingApprovals = approvals),
      setPendingUserInputs: (requests) => (pendingUserInputs = requests),
      setUsageSnapshot: (sessionId, usage) => (usageSnapshotsBySession = cacheSessionUsage(usageSnapshotsBySession, sessionId, usage)),
      setQueueSnapshot: applyPromptQueue,
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

  async function applySessionAccess(mode: SessionControlId): Promise<void> {
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
      executionProfile = await updateSessionExecutionProfile(session.id, mode);
      // The profile belongs to this session only. Keep the current list entry
      // coherent after the backend closes its idle runtime, without reloading
      // every session in the workspace (which also reloads unrelated list and
      // conversation context on this path).
      markSessionIdle(session);
      notice = '会话设置已更新。';
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
        sessionModelCatalog = sessionModelCatalogs.get(session.id) ?? null;
        sessionModelOverride = null;
        sessionModelCatalogLoading = false;
      });
      return;
    }
    untrack(() => {
      ++sessionModelRequestGeneration;
      sessionModelCatalog = session ? sessionModelCatalogs.get(session.id) ?? null : null;
      sessionModelOverride = null;
      sessionModelCatalogLoading = false;
      if (enabled && session && !session.archived) void loadSessionModels();
    });
  });

  async function loadSessionModels(): Promise<void> {
    const session = selectedSession;
    if (!desktop || !session || session.archived || !session.capabilities.includes('model.select') || isSessionRunning(session)) return;
    const generation = ++sessionModelRequestGeneration;
    sessionModelCatalogLoading = true;
    errorMessage = null;
    try {
      const catalog = await getSessionModels(session.id);
      if (generation === sessionModelRequestGeneration && selectedSessionId === session.id) {
        sessionModelCatalogs.set(session.id, catalog);
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
      sessionModelCatalogs.set(session.id, result.catalog);
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
          if (ownsSelection()) { sessionModelCatalogs.set(session.id, catalog); sessionModelCatalog = catalog; sessionModelOverride = null; }
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

  async function applySessionContextWindow(contextWindow: string, modelReference: string): Promise<void> {
    await applyModelChange({ kind: 'contextWindow', contextWindow, modelReference });
  }

  async function applySessionServiceTier(serviceTier: string): Promise<void> {
    await applyModelChange({ kind: 'serviceTier', serviceTier });
  }

  async function executeBuiltinCommand(input: string): Promise<boolean> {
    const command = parseAgentCommand(input);
    if (!command || !selectedSession || !sessionBuiltinCommands(selectedSession, executionProfile?.sessionId === selectedSession.id ? executionProfile.sessionControls : []).some(item => item.name === command.name)) return false;

    const control = executionProfile?.sessionId === selectedSession.id
      ? executionProfile.sessionControls?.find(option => option.command === command.name) : undefined;
    if (control) {
      if (command.args) { errorMessage = `/${command.name} 不接受参数。`; return true; }
      await applySessionAccess(control.id);
      if (!errorMessage) composerText = '';
      return true;
    }
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
          if (session.capabilities.includes('session.tree')) {
            await refreshPiTree(session.id);
            piTreeOpen = true;
          } else await refreshCodexThread(session.id);
          notice = '会话已刷新。';
        });
        return true;
      case 'session':
        if (command.args) {
          errorMessage = '/session 不接受参数。';
          return true;
        }
        notice = `${session.label} · ${session.externalSessionId ?? '尚未绑定远端会话 ID'}`;
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
          notice = '上下文压缩已完成。';
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
          notice = '会话资源已重新加载。';
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
      case 'goal':
        await run(async () => {
          if (command.args.toLocaleLowerCase() === 'clear') {
            await agentFacade.invoke(session, 'goal.manage', { action: 'clear' });
            codexGoal = null;
            notice = '当前目标已清除。';
            return;
          }
          if (!command.args) {
            const result = await agentFacade.invoke(session, 'goal.manage', { action: 'get' });
            const goal = normalizeAgentGoal(result);
            notice = goal?.objective
              ? `当前目标：${goal.objective}${goal.status ? ` · ${goal.status}` : ''}`
              : '当前会话没有目标。';
            return;
          }
          const result = await agentFacade.invoke(session, 'goal.manage', { action: 'set', objective: command.args });
          codexGoal = normalizeAgentGoal(result) ?? {
            objective: command.args,
            status: 'active',
            tokenBudget: null,
            tokensUsed: null,
            updatedAt: null,
          };
          if (session.capabilities.includes('goal.resume')) {
            await agentFacade.invoke(session, 'goal.resume', {});
            await refreshSessions(session.workspaceId);
          }
          notice = `目标已设置：${command.args}`;
        });
        return true;
      case 'skills':
        if (command.args) {
          errorMessage = '/skills 不接受参数。';
          return true;
        }
        await run(async () => {
          agentCommands = await loadSessionCommands(session);
          notice = `已刷新 Skills（${agentCommands.length} 项）。`;
        });
        return true;
      default:
        return false;
    }
  }

  async function sendPrompt() {
    if (await executeBuiltinCommand(composerText)) return;
    await messageController.sendPrompt();
    await refreshPromptQueue();
  }

  async function retryLastPrompt() {
    await messageController.retryLastPrompt();
  }

  async function abortPrompt() {
    await messageController.abortPrompt();
    await refreshPromptQueue();
    if (!errorMessage && selectedSessionId) {
      pendingUserInputs = pendingUserInputs.filter((request) => request.sessionId !== selectedSessionId);
    }
  }

  async function compactCurrentSession(): Promise<void> {
    const session = selectedSession;
    if (!session || !session.capabilities.includes('compaction.run') || session.archived) return;
    if (sessionRunning || busy) {
      errorMessage = '会话运行中不能手动压缩，请等待当前回合结束。';
      return;
    }
    busy = true;
    errorMessage = null;
    setAgentActivity(session.id, true, '正在压缩上下文…');
    try {
      await agentFacade.invoke(session, 'compaction.run', {});
      if (selectedSessionId === session.id) timeline = await getTimeline(session.id);
      setAgentActivity(session.id, false);
      notice = '上下文压缩已完成。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
      setAgentActivity(session.id, false);
    } finally {
      busy = false;
    }
  }

  async function queuePrompt(mode: 'steer' | 'followUp') {
    if (await executeBuiltinCommand(composerText)) return;
    await messageController.queuePrompt(mode);
    await refreshPromptQueue();
  }

  function applyPromptQueue(value: AgentQueueSnapshot | null) {
    if (!value) { queueSnapshot = null; return; }
    if (value.sessionId === selectedSessionId) queueSnapshot = newerMessageQueue(queueSnapshot, value);
  }

  async function refreshPromptQueue() {
    const session = selectedSession;
    if (!desktop || !session?.capabilities.includes('queue.manage')) return;
    try {
      const result = await agentFacade.invoke(session, 'queue.manage', { action: 'get' });
      if (selectedSessionId === session.id) applyPromptQueue(normalizeMessageQueue(result, session.id));
    } catch (error) {
      if (selectedSessionId === session.id) errorMessage = toErrorMessage(error);
    }
  }

  $effect(() => {
    const id = selectedSessionId;
    const enabled = desktop && selectedSession?.capabilities.includes('queue.manage');
    untrack(() => { queueSnapshot = null; if (enabled && id) void refreshPromptQueue(); });
  });

  async function managePromptQueue(action: 'clear' | 'remove' | 'sendNow' | 'resume', id?: string) {
    const session = selectedSession;
    if (!session?.capabilities.includes('queue.manage') || busy) return;
    busy = true;
    errorMessage = null;
    try {
      const result = await agentFacade.invoke(session, 'queue.manage', { action, ...(id ? { id } : {}) });
      if (selectedSessionId === session.id) applyPromptQueue(normalizeMessageQueue(result, session.id));
      await Promise.all([refreshTimeline(session.id), refreshAttachments(session.id), refreshSessions(session.workspaceId)]);
    } catch (error) {
      if (selectedSessionId === session.id) errorMessage = toErrorMessage(error);
    } finally { busy = false; }
  }

  async function clearPromptQueue() { await managePromptQueue('clear'); }

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
      userInputDrafts = clearRequestDrafts(request, userInputDrafts);
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
    if (createSessionWorkspaceId) void refreshPluginInstallations().catch(error => { errorMessage = toErrorMessage(error); });
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

  const agentFacade = createAgentFacade({ invokeAgentCapability });
  const modelConfigurationService = createModelConfigurationService({
    facade: agentFacade,
    getSessionModels,
    getSessionExecutionProfile,
  });

  const messageController = createMessageController({
    api: {
      createDefaultSession: async (workspaceId) => {
        const providers = readySessionProviders(pluginInstallations);
        if (providers.length !== 1) throw new Error('请先选择一个 Agent 插件并创建会话。');
        const provider = providers[0];
        return createAgentSession(workspaceId, provider.contributionId, provider.installationId);
      },
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

{#snippet presentationPackageManagement()}
  <SettingsSection title="皮肤插件" error={presentationPackages.error} items={[
    { id: 'install', title: '安装皮肤', description: '从本地目录添加新的外观插件。', icon: 'plugins',
      actions: [{ id: 'install', label: '安装皮肤插件', intent: 'install', disabled: !desktop || presentationPackages.busy }] },
    { id: 'builtin', title: '使用内置皮肤', description: '停用当前外部皮肤，保留工作台布局。', icon: 'undo',
      actions: [{ id: 'restore', label: '恢复内置呈现', intent: 'restore', disabled: presentationPackages.busy }] },
    ...presentationPackages.releases.map(release => ({ id: release.digest, title: release.manifest.displayName,
      description: `${release.manifest.version} · ${release.enabled ? '已启用' : '已禁用'}`,
      actions: [
        { id: 'toggle', label: release.enabled ? '禁用' : '启用', intent: 'toggle' as const, disabled: presentationPackages.busy },
        { id: 'uninstall', label: '卸载', intent: 'remove' as const, disabled: presentationPackages.busy },
      ] })),
  ]} onAction={(item, action) => {
    if (item === 'install') void presentationOperation(installPresentationFromDirectory);
    else if (item === 'builtin') void presentationOperation(() => desktop ? presentationPackagesController.select(null) : Promise.resolve());
    else {
      const release = presentationPackages.releases.find(release => release.digest === item);
      if (!release) return;
      if (action === 'toggle') void presentationOperation(() => presentationPackagesController.enable(release.digest, !release.enabled));
      else if (action === 'uninstall') void presentationOperation(() => presentationPackagesController.uninstall(release.digest));
    }
  }} />
{/snippet}

{#snippet extensionManagement()}
  <PluginManagerPanel
    installations={pluginManagerInstallations}
    busy={pluginBusy || !desktop}
    onInstall={hostGuard('onInstall', () => void installPlugin())}
    onEnabledChange={hostGuard('onEnabledChange', (id, enabled) => void enablePlugin(id, enabled))}
    onUninstall={hostGuard('onUninstall', (id) => void uninstallPlugin(id))}
    onConfigure={hostGuard('onConfigure', configureAgent)}
    onCreateSession={hostGuard('onCreateSession', (installationId, agentId) => void createPluginSession(installationId, agentId))}
  />
  {#if agentSettings.target}
    <section aria-label="Agent 插件设置">
      <p>{pluginInstallations.find(item => item.id === agentSettings.target?.installationId)?.manifest.displayName ?? 'Agent'} · {agentSettingsScopeLabel(agentSettings.target.scope)}</p>
      {#if agentSettings.snapshot}
        {#if agentSettings.snapshot.descriptor.scopes.includes('application')}<Button type="button" variant="outline" onclick={() => selectAgentSettingsScope({kind:'application'})}>全局</Button>{/if}
        {#if agentSettings.snapshot.descriptor.scopes.includes('workspace')}<Button type="button" variant="outline" disabled={!selectedWorkspaceId} onclick={() => selectedWorkspaceId && selectAgentSettingsScope({kind:'workspace',id:selectedWorkspaceId})}>当前项目</Button>{/if}
        {#if agentSettings.snapshot.descriptor.scopes.includes('session')}<Button type="button" variant="outline" disabled={!selectedSession || selectedSession.pluginInstallationId !== agentSettings.target.installationId || selectedSession.agent !== agentSettings.target.contributionId || selectedSession.archived} onclick={() => selectedSession && selectAgentSettingsScope({kind:'session',id:selectedSession.id})}>当前会话</Button>{/if}
        <AgentSettingsForm snapshot={agentSettings.snapshot} draft={agentSettings.draft} busy={agentSettings.loading || agentSettings.saving} error={agentSettings.error} notice={agentSettings.notice} onChange={agentSettingsController.change} onSave={() => void agentSettingsController.save()} onReset={agentSettingsController.reset} onReload={() => void agentSettingsController.reload()} />
      {:else if agentSettings.loading}<p role="status">正在读取 Agent 设置…</p>
      {:else if agentSettings.error}<p role="alert">{agentSettings.error}</p><Button type="button" onclick={() => void agentSettingsController.reload()}>重试</Button>{/if}
      <Button type="button" variant="ghost" onclick={() => void agentSettingsController.select(null)}>收起设置</Button>
    </section>
  {/if}
  {#if pluginError}<p role="alert">{pluginError}</p>{/if}
{/snippet}

{#snippet runtimeStatus()}
  <div class="management-runtime-actions">
    <Button variant="outline" size="sm" type="button" onclick={() => void refresh()} disabled={busy}>
      刷新运行状态
    </Button>
  </div>
  <DiagnosticsPanel
    presentationActions={diagnosticsActions}
    open={true}
    embedded={true}
    diagnostics={diagnostics}
    desktop={desktop}
    workspaceCount={workspaces.length}
    sessionCount={sessions.length}
    busy={busy}
    onRefresh={() => void refresh()}
    onClose={() => (settingsOpen = false)}
  />
{/snippet}

{#snippet hostPanelActions()}
  {#if capabilityHistoryOpen}
    <Button variant="outline" size="sm" disabled={!desktop || capabilityHistory.loadingScopes} onclick={() => void capabilityHistoryController.open()}>刷新作用域</Button>
  {:else if historyOpen}
    <Button variant="outline" size="sm" disabled={!desktop || !historyWorkspaceId || executionHistory.loading} onclick={() => void executionHistoryController.refresh()}>刷新记录</Button>
    <Button variant="outline" size="sm" onclick={openCapabilityHistory}>插件调用历史</Button>
  {/if}
{/snippet}

{#snippet workspaceSettings()}
  <WorkspacePreferencesPanel state={workspacePreferences} {desktop} onChange={trusted => void workspacePreferencesController.save(trusted)} onReload={() => void workspacePreferencesController.load()} />
{/snippet}
{#snippet appearanceActions()}{@render presentationActions('appearance')}{/snippet}
{#snippet diagnosticsActions()}{@render presentationActions('diagnostics')}{/snippet}
{#snippet navigationFooter()}
  <Button variant="ghost" onclick={() => openManagementCenter('extensions')}><Icon name="plugins" />插件与能力</Button>
  <Button variant="ghost" onclick={() => openManagementCenter('appearance')}><Icon name="settings" />工作台设置</Button>
{/snippet}
{#snippet navigationActions()}{@render presentationActions('navigation')}{/snippet}
{#snippet conversationActions()}{@render presentationActions('conversation')}{/snippet}
{#snippet presentationActions(surface: 'conversation' | 'navigation' | 'diagnostics' | 'appearance')}
  <DefaultPresentationActions {surface} layout={presentationLayout} switching={presentationSwitching}
    onSwitchLayout={(layout) => { void workbenchPresentation?.switchPresentation(layout); }}
    onRestore={() => { void workbenchPresentation?.restoreDefault(); }}
    onOpenExecutionHistory={openExecutionHistory} />
{/snippet}

<svelte:head>
  <title>Aibo</title>
</svelte:head>

<svelte:window bind:innerWidth={viewportWidth} onkeydown={handleGlobalKeydown} />

<div
  class="app-shell"
  data-ui-kit={$activeUiKitName}
  data-ui-theme={$activeTheme.id}
  data-color-scheme={$activeTheme.colorScheme}
  style={$activeThemeStyle}
>
  <CommandPalette
    open={commandPaletteOpen}
    commands={commandPaletteCommands}
    onClose={() => (commandPaletteOpen = false)}
  />
  <WindowTitlebar
    onOpenManagement={() => openManagementCenter('appearance')}
    {managementNeedsAttention}
    themeLabel={$activeTheme.label}
    onToggleTheme={() => {
      const next = availableUiKits.find(kit => kit.id === $activeUiKitName)?.themes.find(theme => theme.colorScheme !== $activeTheme.colorScheme);
      if (next) setUiTheme(next.id);
    }}
    sidePanelOpen={sidePanelOpen}
    onToggleSidePanel={toggleSidePanel}
    onToggleMaximize={toggleMaximizeWindow}
    onMinimize={minimizeAppWindow}
    onClose={closeAppWindow}
  />
  <SettingsPanel
    {workspaceSettings}
    packageManagement={presentationPackageManagement}
    presentationActions={appearanceActions}
    extensions={extensionManagement}
    runtime={runtimeStatus}
    open={settingsOpen}
    activeSection={managementSection}
    uiKits={presentationOptions}
    activeUiKitName={presentationPackages.active?.release.digest ?? $activeUiKitName}
    activeThemeId={presentationPackages.themeId ?? $activeTheme.id}
    onSelectUiKit={id => void presentationOperation(() => choosePresentation(id))}
    onSelectTheme={id => void presentationOperation(() => choosePresentationTheme(id))}
    onSelectSection={section => { managementSection = section; }}
    onClose={() => (settingsOpen = false)}
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
  {#if sessionHistoryOpen}
    <div class="host-session-history-region" style="order:2; display:grid; flex:1; min-height:0; overflow:auto;">
      <SessionHistoryPanel {workspaces} workspaceId={sessionHistoryWorkspaceId} state={sessionHistory} {desktop}
        onWorkspace={id=>{sessionHistoryWorkspaceId=id;}} onSession={id=>void sessionHistoryController.select(id)}
        onRefresh={()=>void sessionHistoryController.refresh()} onOlder={()=>void sessionHistoryController.older()}
        onNewer={()=>void sessionHistoryController.newer()} onLatest={()=>void sessionHistoryController.latest()} onClose={closeSessionHistory}
        onReload={()=>{if (sessionHistoryWorkspaceId) void sessionHistoryController.open(sessionHistoryWorkspaceId, sessionHistory.selectedId);}} />
    </div>
  {/if}
  {#if historyOpen || capabilityHistoryOpen}
    <HostPanel actions={hostPanelActions} title={capabilityHistoryOpen ? '插件调用历史' : '执行历史'}
      backLabel={capabilityHistoryOpen ? '执行历史' : undefined}
      onBack={capabilityHistoryOpen ? backFromCapabilityHistory : undefined}
      onClose={closeHostPanel}>
      {#if capabilityHistoryOpen}
        <div class="host-capability-history-region" style="order:2;display:grid;flex:1;min-height:0;overflow:auto;">
          <CapabilityHistoryPanel state={capabilityHistory} {desktop} onSource={source=>void capabilityHistoryController.selectSource(source)} onSelect={scope=>void capabilityHistoryController.select(scope)}
            onReload={()=>void capabilityHistoryController.open()} onMoreScopes={()=>void capabilityHistoryController.moreScopes()}
            onRefresh={()=>void capabilityHistoryController.refresh()} onOlder={()=>void capabilityHistoryController.older()}
            onNewer={()=>void capabilityHistoryController.newer()} onLatest={()=>void capabilityHistoryController.latest()} />
        </div>
      {/if}
      {#if historyOpen}
        <div class="host-history-region" hidden={capabilityHistoryOpen}>
          <ExecutionHistoryPanel {workspaces} workspaceId={historyWorkspaceId} windowId={presentationWindowId()} state={executionHistory} {desktop}
            onSelectWorkspace={id => { historyWorkspaceId = id; }}
            onStop={key => void executionHistoryController.stop(key)}
            onOlder={() => void executionHistoryController.older()} onNewer={() => void executionHistoryController.newer()} onLatest={() => void executionHistoryController.latest()} />
        </div>
      {/if}
    </HostPanel>
  {/if}
<PresentationHost readAttachmentPreview={getSessionAttachmentPreview} onPasteImages={(files) => void pasteComposerImages(files)} hideWhenSuspended={sessionHistoryOpen} onRestore={() => void presentationOperation(() => presentationPackagesController.select(null))} bind:this={presentationHost} active={presentationPackages.active} themeId={presentationPackages.themeId} input={externalInput} suspended={historyOpen || sessionHistoryOpen || capabilityHistoryOpen || settingsOpen || commandPaletteOpen || archiveConfirmationSessionId !== null || piNavigationEntryId !== null} onIntent={externalIntent}>
<WorkbenchPresentation hideWhenSuspended={sessionHistoryOpen} onRestore={() => desktop ? presentationPackagesController.select(null) : Promise.resolve()} bind:this={workbenchPresentation} bind:layout={presentationLayout} bind:switching={presentationSwitching} bind:gridElement={workspaceGridElement} navigationWidth={workspaceSidebarWidth} auxiliaryWidth={inspectorWidth} auxiliaryOpen={sidePanelOpen} suspended={historyOpen || sessionHistoryOpen || capabilityHistoryOpen || settingsOpen || commandPaletteOpen || archiveConfirmationSessionId !== null || piNavigationEntryId !== null} windowId={presentationWindowId()} snapshot={{ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId, draft: composerText, navigation: sidePanelView, timelineRevision: timeline.length }}>
{#snippet navigation(guard)}
    <WorkspaceSidebar
      presentationActions={navigationActions}
      footerActions={navigationFooter}
      workspaces={workspaceItems}
      sessionsByWorkspace={sessionItemsByWorkspace}
      selectedWorkspaceId={selectedWorkspaceId}
      expandedWorkspaceIds={expandedWorkspaceIds}
      selectedSessionId={selectedSessionId}
      sessionsLoadingWorkspaceIds={sessionsLoadingWorkspaceIds}
      busy={busy || pluginBusy}
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
      {agentChoices}
      onCreateAgent={guard('onCreateAgent', (workspaceId, choiceId) => void createWheelSession(workspaceId, choiceId))}
      onSelectSession={guard('onSelectSession', (id) => { installedTool = null; selectSession(id); })}
      onUnarchiveSession={guard('onUnarchiveSession', (sessionId) => void unarchiveSession(sessionId))}
      onRequestArchiveSession={guard('onRequestArchiveSession', requestArchiveSession)}
      onSyncCodexThread={guard('onSyncCodexThread', (sessionId) => void syncCodexThread(sessionId))}
      onBeginRenameSession={guard('onBeginRenameSession', beginRenameSession)}
      onSaveSessionRename={guard('onSaveSessionRename', () => void saveSessionRename())}
      onCancelRenameSession={guard('onCancelRenameSession', cancelRenameSession)}
    />
{/snippet}
{#snippet navigationResize(guard, slot)}
    <ColumnSplitter
      label="调整工作区与会话宽度"
      width={workspaceSidebarWidth}
      onPointerDown={guard('onPointerDown', (event) => beginColumnResize('workspace', event, slot.growthDirection))}
      onKeyDown={guard('onKeyDown', (event) => handleSplitterKeydown('workspace', event, slot.growthDirection))}
    />
{/snippet}
{#snippet content(guard)}
    {#if installedTool && contributionAvailable(installedTool)}
      {#key JSON.stringify([installedScope,installedTool.installationId,installedTool.contributionId])}
        {#await loadInstalledWorkbench() then workbench}
          <workbench.default title={installedTool.title} state={installedWorkbenchState}
            onAction={guard('onAction', (message) => void installedWorkbenchController?.act(message))}
            onReload={guard('onReload', () => void installedWorkbenchController?.reload())}
            onToggleLayout={guard('onToggleLayout', () => installedWorkbenchController?.toggleLayout())}
            onToggleReading={guard('onToggleReading', () => installedWorkbenchController?.toggleReading())}
            onClose={guard('onClose', () => installedTool = null)} />
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
    <!-- Input callbacks refresh their session guard; a function-binding setter
         is initialized once and would reject edits after session navigation. -->
    <TimelinePanel
      presentationActions={conversationActions}
      activeTab={sessionTabs[selectedSessionId ?? ''] ?? 'conversation'}
      onSelectTab={guard('onSelectTab', (tab) => {
        sessionTabs[selectedSessionId ?? ''] = tab;
        if (tab === 'changes' && selectedWorkspaceId) void refreshWorkspaceChanges(selectedWorkspaceId);
      })}
      changesPanel={sessionChanges}
      workspace={selectedWorkspace}
      session={selectedSession}
      selectedSessionId={selectedSessionId}
      {codexGoal}
      goalBusy={goalBusy}
      onClearGoal={guard('onClearGoal', () => void changeGoal('clear'))}
      onPauseGoal={guard('onPauseGoal', () => void changeGoal('pause'))}
      onResumeGoal={guard('onResumeGoal', () => void changeGoal('resume'))}
      codexThreadSnapshot={codexThreadSnapshot}
      timeline={timeline}
      timelineVisibleCount={timelineVisibleCount}
      usageValues={usageValues}
      retryPrompt={retryPrompt}
      retryReason={retryReason}
      onOpenSubagent={guard('onOpenSubagent', (id) => void openSubagent(id))}
      userInputRequests={selectedUserInputRequests}
      {userInputDrafts}
      onUserInputDraftChange={guard('onUserInputDraftChange', (value) => { userInputDrafts = value; })}
      queueSnapshot={queueSnapshot}
      agentActivityLabel={agentActivityLabel}
      contextCompacting={contextCompacting}
      sessionRunning={sessionRunning}
      selectedSessionArchiving={selectedSessionArchiving}
      busy={busy}
      attachments={attachments}
      {attachmentPreviews}
      executionProfile={executionProfile}
      modelConfiguration={modelConfigurationState(selectedSession, sessionModelCatalog, executionProfile)}
      modelCatalog={sessionModelCatalog}
      modelCatalogLoading={sessionModelCatalogLoading}
      modelOverride={sessionModelOverride}
      workspacePathSuggestions={workspacePathSuggestions}
      sessionSuggestions={sessionSuggestions}
      sessionIcons={Object.fromEntries(sessionSuggestions.map(session => [session.id, sessionProviderIcon(pluginInstallations, session)]))}
      onSelectSessionReference={guard('onSelectSessionReference', selectComposerSessionReference)}
      agentCommands={visibleAgentCommands}
      agentCommandsLoading={agentCommandsLoading}
      composerDraftFailed={composerDraftFailed}
      composerText={composerText}
      onComposerInput={guard('onComposerInput', (value) => { composerText = value; handleComposerInput(value); })}
      onSelectWorkspacePath={guard('onSelectWorkspacePath', selectComposerWorkspacePath)}
      onAddAttachments={guard('onAddAttachments', () => void chooseSessionAttachments())}
      onPasteImages={guard('onPasteImages', (files) => void pasteComposerImages(files))}
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
      onQueue={guard('onQueue', (mode) => void queuePrompt(mode))}
      onClearQueue={guard('onClearQueue', () => void clearPromptQueue())}
      onRemoveQueuedMessage={guard('onRemoveQueuedMessage', (id) => void managePromptQueue('remove', id))}
      onSendQueuedMessage={guard('onSendQueuedMessage', (id) => void managePromptQueue('sendNow', id))}
      onResumeQueue={guard('onResumeQueue', () => void managePromptQueue('resume'))}
      onAbort={guard('onAbort', () => void abortPrompt())}
      onSelectAccess={guard('onSelectAccess', (mode) => void applySessionAccess(mode))}
      onLoadModels={guard('onLoadModels', () => void loadSessionModels())}
      onSelectModelConfiguration={guard('onSelectModelConfiguration', (model, reasoningEffort) => void applySessionModelConfiguration(model, reasoningEffort))}
      onSelectServiceTier={guard('onSelectServiceTier', (serviceTier) => void applySessionServiceTier(serviceTier))}
      onSelectContextWindow={guard('onSelectContextWindow', (contextWindow, modelReference) => void applySessionContextWindow(contextWindow, modelReference))}
      onCompact={guard('onCompact', () => void compactCurrentSession())}
    />
    {/if}
{/snippet}
{#snippet sessionChanges()}
  <section class="session-changes" aria-label="工作区变更">
  <header class="session-changes-heading"><div><h3>工作区变更</h3><p>未提交的文件 · 共用工作区的会话共享这些变更</p></div>
  <Button variant="outline" disabled={!desktop || workspaceChangesLoading} onclick={() => { sessionDiffController.close(); if (selectedWorkspaceId) void refreshWorkspaceChanges(selectedWorkspaceId); }}><Icon name="refresh" size={14} />{workspaceChangesLoading ? '正在刷新…' : '刷新变更'}</Button></header>
  {#if !desktop}<p role="status">读取 Git 变更需要桌面宿主。</p>
  {:else if workspaceChangesLoading}<p role="status">正在读取变更…</p>
  {:else if workspaceChangesError}<p role="alert">{workspaceChangesError}</p>
  {:else}
    {#if discoveryLimited}<p role="status">仓库扫描尚未完成，以下仅显示已发现的仓库。</p>{/if}
    {#each discoveryWarnings as warning}<p role="alert">{warning}</p>{/each}
    {#each visibleRepositories as repo (repo.id)}
      <section class="session-changes-repo" aria-label={`仓库 ${repo.name}`}>
        <header class="session-changes-repo-heading"><strong>{repo.name}</strong><span>{repo.relativePath}</span>{#if repo.changes?.captureStatus === 'captured'}<Badge variant="outline">{repo.changes.files.length} 个文件</Badge>{/if}</header>
        {#if repo.error}<p role="alert">{repo.error}</p>
        {:else if !repo.changes}<p role="status">正在读取变更…</p>
        {:else if repo.changes.captureStatus !== 'captured'}<p role="status">{repo.changes.captureError ?? '无法读取此仓库的变更。'}</p>
        {:else}
          {#each repo.changes.files as file (file.path)}
            <div class="session-change-row">
              <Icon name="file" size={15} />
              <span class="session-change-path" title={file.path}>{file.path}</span>
              <Badge variant={file.conflicted ? 'destructive' : 'outline'}>{file.conflicted ? '冲突' : file.untracked ? '未跟踪' : file.staged && file.unstaged ? '部分暂存' : file.staged ? '已暂存' : '未暂存'}</Badge>
              <div class="session-change-actions">
              {#each [false, true] as staged}
                {#if staged ? file.staged : file.unstaged || file.untracked || file.conflicted}
                  <Button variant="ghost" onclick={() => { if (selectedWorkspaceId) void sessionDiffController.open(selectedWorkspaceId, repo.id, file.path, staged); }}>{staged ? '查看暂存差异' : file.untracked ? '查看未跟踪文件' : '查看未暂存差异'}</Button>
                {/if}
              {/each}
              </div>
            </div>
          {:else}<p role="status">没有未提交变更。</p>{/each}
        {/if}
      </section>
    {:else}<p role="status">当前工作区未发现 Git 仓库。</p>{/each}
  {/if}
  {#if sessionDiff.path}
    <WorkspaceFileDiffPreview fileDiff={sessionDiff.diff} fileDiffLoading={sessionDiff.loading} fileDiffError={sessionDiff.error} selectedPath={sessionDiff.path} selectedStaged={sessionDiff.staged} onClose={() => sessionDiffController.close()} />
  {/if}
  </section>
{/snippet}
{#snippet auxiliaryResize(guard, slot)}
    {#if sidePanelOpen}
      <ColumnSplitter
        label="调整会话与侧边栏宽度"
        width={inspectorWidth}
        onPointerDown={guard('onPointerDown', (event) => beginColumnResize('inspector', event, slot.growthDirection))}
        onKeyDown={guard('onKeyDown', (event) => handleSplitterKeydown('inspector', event, slot.growthDirection))}
      />
    {/if}
{/snippet}
{#snippet auxiliary(guard)}
    {#if sidePanelOpen}
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
      {artifactPreview}
      onToggleArtifact={guard('onToggleArtifact', (sessionId, artifactId) => artifactPreviewController.toggle(sessionId, artifactId))}
      projectEditor={projectEditors[selectedWorkspaceId ?? ''] ?? emptyProjectEditor()}
      runningActionId={projectRunningActions[selectedWorkspaceId ?? ''] ?? null}
      onEditProjectAction={guard('onEditProjectAction', (id) => projectEditor.edit(id))}
      onProjectField={guard('onProjectField', (field, value) => projectEditor.change(field, value))}
      onSaveProjectEditor={guard('onSaveProjectEditor', () => projectEditor.save())}
      onCloseProjectEditor={guard('onCloseProjectEditor', () => projectEditor.close())}
      onDeleteProjectAction={guard('onDeleteProjectAction', deleteCurrentProjectAction)}
      onCancelProjectAction={guard('onCancelProjectAction', cancelCurrentProjectAction)}
      onRunProjectAction={guard('onRunProjectAction', runCurrentProjectAction)}
      onRefresh={guard('onRefresh', () => void refresh())}
      onSelectView={guard('onSelectView', selectSidePanelView)}
      />
      {:else if sidePanelView === 'git'}
        {#key `${selectedWorkspaceId}:${repositoryId}`}
        <WorkspaceGitPanel draftState={workbenchDrafts.git[gitDraftKey] ?? emptyGitPanelState()} onDraftChange={guard('onDraftChange', (value) => { if (selectedWorkspaceId) workbenchDrafts.git[gitDraftKey] = value; })}
          repositories={visibleRepositories} {repositoryId} {repositorySearch} {discoveryLimited} {discoveryWarnings}
          collapsedRepositories={repositoryViews[selectedWorkspaceId ?? '']?.collapsed ?? []}
          onSelectRepository={guard('onSelectRepository', selectRepository)} onRepositorySearch={guard('onRepositorySearch', (value) => repositorySearch = value)} onToggleRepository={guard('onToggleRepository', toggleRepository)}
          onContinueDiscovery={guard('onContinueDiscovery', () => { repositoryScanBudget = Math.min(repositoryScanBudget * 4, 100000); if (selectedWorkspaceId) void refreshWorkspaceChanges(selectedWorkspaceId); })}
          workspace={selectedWorkspace}
          desktop={desktop}
          changes={workspaceChanges}
          loading={workspaceChangesLoading}
          error={workspaceChangesError}
          selectedFilePath={workspaceFileDiffPath}
          selectedFileStaged={workspaceFileDiffStaged}
          {previewRepositoryId}
          branches={workspaceGitBranches}
          history={workspaceGitHistory}
          historyHasMore={workspaceGitHistoryHasMore}
          historyLoadingMore={workspaceGitHistoryLoadingMore}
          historyLoadMoreError={workspaceGitHistoryLoadMoreError}
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
          onApplyFileAction={guard('onApplyFileAction', (workspaceId, path, action, repo) => void applyWorkspaceGitAction(workspaceId, path, action, repo))}
          onApplyWorkspaceAction={guard('onApplyWorkspaceAction', (workspaceId, action, repo) => void applyWorkspaceGitWorkspaceAction(workspaceId, action, repo))}
          onCommit={guard('onCommit', (workspaceId, message) => commitWorkspaceGitChanges(workspaceId, message))}
          onOpenDiff={guard('onOpenDiff', (workspaceId, path, staged, repo) => void openWorkspaceFileDiff(workspaceId, path, staged, repo))}
          onRefreshGitMetadata={guard('onRefreshGitMetadata', (workspaceId) => void refreshWorkspaceGitMetadata(workspaceId))}
          onLoadMoreHistory={guard('onLoadMoreHistory', (workspaceId) => void loadMoreWorkspaceGitHistory(workspaceId))}
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
{/snippet}
{#snippet overlays(guard)}
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

{/snippet}
</WorkbenchPresentation>
</PresentationHost>
<footer class="workbench-status" aria-label="工作台状态"><span>{desktop ? '本地工作区' : '浏览器预览'}</span><span>{selectedWorkspace?.label ?? '未选择工作区'}</span><span>{$activeTheme.label}</span></footer>
  <AppOverlays
    {errorMessage}
    {notice}
    archiveConfirmationOpen={archiveConfirmationSessionId !== null}
    piNavigationOpen={piNavigationEntryId !== null}
    {piNavigationMode}
    {piNavigationCustomInstructions}
    onConfirmArchive={() => void confirmArchiveSession()}
    onCancelArchive={() => (archiveConfirmationSessionId = null)}
    onSetPiNavigationMode={(mode) => (piNavigationMode = mode)}
    onSetPiNavigationCustomInstructions={(value) => (piNavigationCustomInstructions = value)}
    onConfirmPiNavigation={(options) => void confirmPiTreeNavigation(options)}
    onCancelPiNavigation={() => (piNavigationEntryId = null)}
  />

{#if selectedSubagent}
  <SubagentDetails open={subagentOpen} agent={selectedSubagent} entries={subagentEntries} loading={subagentLoading} error={subagentError}
    onClose={() => subagentOpen = false} onRetry={() => void openSubagent(selectedSubagent!.id)} />
{/if}

</div>
