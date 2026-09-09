import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { UiPluginViewDocument } from './ui-kit/contract';
import type {
  AgentDiagnostic,
  WorkspaceCapabilityInventory,
  AgentEvent,
  AgentName,
  ApprovalDecision,
  AppSnapshot,
  CodexThreadSnapshot,
  CodexThreadSummary,
  PiSessionTreeNavigation,
  PiTreeNavigationOptions,
  PiSessionSnapshot,
  PiSessionTreeSnapshot,
  SessionListOptions,
  ExecutionProfile,
  ResolvedExecutionProfile,
  SessionExecutionProfile,
  Session,
  SessionModelCatalog,
  TimelineItem,
  TurnChangeSet,
  RestoreTurnChangeSetResult,
  RestoreOperation,
  WorkspaceChanges,
  WorkspaceFileDiff,
  TurnFileDiff,
  GitFileAction,
  GitFileActionResult,
  GitWorkspaceAction,
  GitWorkspaceActionResult,
  GitCommitResult,
  GitBranch,
  GitCommit,
  GitCommitFileList,
  GitRemoteStatus,
  GitSyncAction,
  GitStashEntry,
  GitHunkActionResult,
  ContextAttachment,
  ContextAttachmentValidation,
  CheckpointFile,
  Artifact,
  ArtifactContent,
  ProjectAction,
  ProjectActionKind,
  ProjectActionRun,
  Workspace,
  WorkspacePathSuggestion,
  AgentCommand,
  ComposerDraft,
} from './types';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface PluginInstallation {
  id: string;
  pluginId: string;
  pluginVersion: string;
  packageDigest: string;
  enabled: boolean;
  installed: boolean;
  runnable: boolean;
  dependencies: { kind: string; name: string; required: boolean; available: boolean; executable: string | null; versionRange: string | null; detectedVersion: string | null; issue: string | null }[];
  manifest: { displayName: string; agents: { agentId: string; displayName: string }[]; [key: string]: unknown };
}
export const listPluginInstallations = (): Promise<PluginInstallation[]> => invoke('list_plugin_installations');
export const installAgentPlugin = (path: string): Promise<PluginInstallation> => invoke('install_agent_plugin', { path });
export const setAgentPluginEnabled = (id: string, enabled: boolean): Promise<void> => invoke('set_agent_plugin_enabled', { id, enabled });
export const uninstallAgentPlugin = (id: string): Promise<void> => invoke('uninstall_agent_plugin', { id });
export const createAgentSession = (workspaceId: string, agentId: string, installationId?: string): Promise<Session> => invoke('create_agent_session', { workspaceId, agentId, installationId });
export const sendAgentPrompt = (sessionId: string, input: string): Promise<Session> => invoke('send_agent_prompt', { sessionId, input });
export const cancelAgentTurn = (sessionId: string): Promise<void> => invoke('cancel_agent_turn', { sessionId });
export const resumeAgentSession = (sessionId: string): Promise<void> => invoke('resume_agent_session', { sessionId });
export const closeAgentSession = (sessionId: string): Promise<void> => invoke('close_agent_session', { sessionId });
export const getPluginViews = (sessionId: string): Promise<UiPluginViewDocument[]> => invoke('get_plugin_views', { sessionId });
export const invokePluginViewAction = (sessionId: string, viewId: string, actionId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => invoke('invoke_plugin_view_action', { sessionId, viewId, actionId, input });
export const invokeAgentCapability = (sessionId: string, capability: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => invoke('invoke_agent_capability', { sessionId, capability, input });

export const toggleWindowMaximize = (): Promise<void> => getCurrentWindow().toggleMaximize();

export const minimizeWindow = (): Promise<void> => getCurrentWindow().minimize();

export const closeWindow = (): Promise<void> => getCurrentWindow().close();

export const listWorkspaces = (): Promise<Workspace[]> =>
  invoke<Workspace[]>('list_workspaces');

export const searchWorkspacePaths = (
  workspaceId: string,
  query: string,
): Promise<WorkspacePathSuggestion[]> =>
  invoke<WorkspacePathSuggestion[]>('search_workspace_paths', { workspaceId, query });

export const getComposerDraft = (sessionId: string): Promise<ComposerDraft | null> =>
  invoke<ComposerDraft | null>('get_composer_draft', { sessionId });

export const saveComposerDraft = (
  sessionId: string,
  text: string,
  sendFailed = false,
): Promise<ComposerDraft | null> =>
  invoke<ComposerDraft | null>('save_composer_draft', { sessionId, text, sendFailed });

export const listPiCommands = (sessionId: string): Promise<AgentCommand[]> =>
  invoke<AgentCommand[]>('list_pi_commands', { sessionId });

export const compactPiSession = (
  sessionId: string,
  instructions?: string,
): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('compact_pi_session', {
    sessionId,
    instructions: instructions?.trim() || null,
  });

export const setPiThinkingLevel = (
  sessionId: string,
  level?: string,
): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('set_pi_thinking_level', {
    sessionId,
    level: level?.trim() || null,
  });

export const setPiModel = (
  sessionId: string,
  reference?: string,
): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('set_pi_model', {
    sessionId,
    reference: reference?.trim() || null,
  });

export const getSessionModels = (sessionId: string): Promise<SessionModelCatalog> =>
  invoke<SessionModelCatalog>('get_session_models', { sessionId });

export const listCodexSkills = (sessionId: string): Promise<AgentCommand[]> =>
  invoke<AgentCommand[]>('list_codex_skills', { sessionId });

export const getCodexGoal = (sessionId: string): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('get_codex_goal', { sessionId });

export const setCodexGoal = (
  sessionId: string,
  objective: string,
  tokenBudget?: number,
): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('set_codex_goal', {
    sessionId,
    objective,
    tokenBudget: tokenBudget ?? null,
  });

export const clearCodexGoal = (sessionId: string): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('clear_codex_goal', { sessionId });

export const resolveCodexUserInput = (
  sessionId: string,
  requestId: string,
  answers: Record<string, string[]>,
): Promise<void> => invoke('resolve_codex_user_input', { sessionId, requestId, answers });

export const reloadPiSession = (sessionId: string): Promise<Record<string, unknown>> =>
  invoke<Record<string, unknown>>('reload_pi_session', { sessionId });

export const addWorkspace = (path: string): Promise<Workspace> =>
  invoke<Workspace>('add_workspace', { path });

export const setWorkspaceTrust = (
  workspaceId: string,
  trusted: boolean,
): Promise<Workspace> =>
  invoke<Workspace>('set_workspace_trust', { workspaceId, trusted });

export const removeWorkspace = (workspaceId: string): Promise<void> =>
  invoke('remove_workspace', { workspaceId });

export const openWorkspaceLocation = (
  workspaceId: string,
  target: 'finder' | 'terminal' | 'editor',
): Promise<void> => invoke('open_workspace_location', { workspaceId, target });

export const probeAgents = (): Promise<AgentDiagnostic[]> =>
  invoke<AgentDiagnostic[]>('probe_agents');

export const inspectWorkspaceCapabilities = (
  workspaceId: string,
): Promise<WorkspaceCapabilityInventory> =>
  invoke<WorkspaceCapabilityInventory>('inspect_workspace_capabilities', { workspaceId });

export const getAppSnapshot = (): Promise<AppSnapshot> =>
  invoke<AppSnapshot>('get_app_snapshot');

export const resolveExecutionProfile = (
  agent: AgentName,
  requested?: ExecutionProfile | null,
): Promise<ResolvedExecutionProfile> =>
  invoke<ResolvedExecutionProfile>('resolve_execution_profile', {
    agent,
    requested: requested ?? null,
  });

export const getSessionExecutionProfile = (
  sessionId: string,
): Promise<SessionExecutionProfile> =>
  invoke<SessionExecutionProfile>('get_session_execution_profile', { sessionId });

export const updateSessionExecutionProfile = (
  sessionId: string,
  requested: ExecutionProfile,
): Promise<SessionExecutionProfile> =>
  invoke<SessionExecutionProfile>('update_session_execution_profile', {
    sessionId,
    requested,
  });

export const listSessions = (
  workspaceId: string,
  options: SessionListOptions = {},
): Promise<Session[]> =>
  invoke<Session[]>('list_sessions', {
    workspaceId,
    search: options.search ?? null,
    statusFilter: options.statusFilter ?? null,
  });

export const renameSession = (sessionId: string, label: string): Promise<Session> =>
  invoke<Session>('rename_session', { sessionId, label });

export const archiveSession = (sessionId: string): Promise<Session> =>
  invoke<Session>('archive_session', { sessionId });

export const unarchiveSession = (sessionId: string): Promise<Session> =>
  invoke<Session>('unarchive_session', { sessionId });

export const getTimeline = (sessionId: string): Promise<TimelineItem[]> =>
  invoke<TimelineItem[]>('get_timeline', { sessionId });

export const getTurnChangeSet = (
  sessionId: string,
  turnId?: string | null,
): Promise<TurnChangeSet | null> =>
  invoke<TurnChangeSet | null>('get_turn_change_set', {
    sessionId,
    turnId: turnId ?? null,
  });

export const restoreTurnChangeSet = (
  sessionId: string,
  turnId: string,
): Promise<RestoreTurnChangeSetResult> =>
  invoke<RestoreTurnChangeSetResult>('restore_turn_change_set', { sessionId, turnId });

export const listTurnCheckpoints = (
  sessionId: string,
  turnId?: string | null,
): Promise<CheckpointFile[]> =>
  invoke<CheckpointFile[]>('list_turn_checkpoints', {
    sessionId,
    turnId: turnId ?? null,
  });

export const listRestoreOperations = (
  sessionId: string,
  turnId?: string | null,
): Promise<RestoreOperation[]> =>
  invoke<RestoreOperation[]>('list_restore_operations', {
    sessionId,
    turnId: turnId ?? null,
  });

export const getWorkspaceChanges = (workspaceId: string): Promise<WorkspaceChanges> =>
  invoke<WorkspaceChanges>('get_workspace_changes', { workspaceId });

export const getWorkspaceFileDiff = (
  workspaceId: string,
  path: string,
  staged = false,
): Promise<WorkspaceFileDiff> =>
  invoke<WorkspaceFileDiff>('get_workspace_file_diff', { workspaceId, path, staged });

export const applyWorkspaceGitFileAction = (
  workspaceId: string,
  path: string,
  action: Extract<GitFileAction, 'stage' | 'unstage'>,
): Promise<GitFileActionResult> =>
  invoke<GitFileActionResult>('apply_workspace_git_file_action', { workspaceId, path, action });

export const applyWorkspaceGitAction = (
  workspaceId: string,
  action: GitWorkspaceAction,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('apply_workspace_git_action', { workspaceId, action });

export const commitWorkspaceChanges = (
  workspaceId: string,
  message: string,
): Promise<GitCommitResult> =>
  invoke<GitCommitResult>('commit_workspace_changes', { workspaceId, message });

export const listWorkspaceGitBranches = (workspaceId: string): Promise<GitBranch[]> =>
  invoke<GitBranch[]>('list_workspace_git_branches', { workspaceId });

export const checkoutWorkspaceGitBranch = (
  workspaceId: string,
  branch: string,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('checkout_workspace_git_branch', { workspaceId, branch });

export const createWorkspaceGitBranch = (
  workspaceId: string,
  branch: string,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('create_workspace_git_branch', { workspaceId, branch });

export const listWorkspaceGitHistory = (
  workspaceId: string,
  limit = 30,
): Promise<GitCommit[]> =>
  invoke<GitCommit[]>('list_workspace_git_history', { workspaceId, limit });

export const listWorkspaceGitCommitFiles = (
  workspaceId: string,
  commit: string,
  offset = 0,
  limit = 10,
): Promise<GitCommitFileList> =>
  invoke<GitCommitFileList>('list_workspace_git_commit_files', { workspaceId, commit, offset, limit });

export const getWorkspaceGitCommitFileDiff = (
  workspaceId: string,
  commit: string,
  path: string,
): Promise<WorkspaceFileDiff> =>
  invoke<WorkspaceFileDiff>('get_workspace_git_commit_file_diff', { workspaceId, commit, path });

export const getWorkspaceGitRemoteStatus = (workspaceId: string): Promise<GitRemoteStatus> =>
  invoke<GitRemoteStatus>('get_workspace_git_remote_status', { workspaceId });

export const syncWorkspaceGit = (
  workspaceId: string,
  action: GitSyncAction,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('sync_workspace_git', { workspaceId, action });

export const listWorkspaceGitStashes = (workspaceId: string): Promise<GitStashEntry[]> =>
  invoke<GitStashEntry[]>('list_workspace_git_stashes', { workspaceId });

export const applyWorkspaceGitStash = (
  workspaceId: string,
  reference: string,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('apply_workspace_git_stash', { workspaceId, reference });

export const stashWorkspaceGit = (
  workspaceId: string,
  message?: string,
): Promise<GitWorkspaceActionResult> =>
  invoke<GitWorkspaceActionResult>('stash_workspace_git', { workspaceId, message: message ?? null });

export const getTurnFileDiff = (
  sessionId: string,
  turnId: string,
  path: string,
): Promise<TurnFileDiff> => invoke<TurnFileDiff>('get_turn_file_diff', { sessionId, turnId, path });

export const applyGitFileAction = (
  sessionId: string,
  path: string,
  action: GitFileAction,
  turnId?: string | null,
): Promise<GitFileActionResult> =>
  invoke<GitFileActionResult>('apply_git_file_action', {
    sessionId,
    path,
    action,
    turnId: turnId ?? null,
  });

export const applyGitHunkAction = (
  sessionId: string,
  turnId: string,
  path: string,
  hunkIndex: number,
  action: GitFileAction,
): Promise<GitHunkActionResult> =>
  invoke<GitHunkActionResult>('apply_git_hunk_action', {
    sessionId,
    turnId,
    path,
    hunkIndex,
    action,
  });

export const registerSessionAttachments = (
  sessionId: string,
  paths: string[],
): Promise<ContextAttachment[]> =>
  invoke<ContextAttachment[]>('register_session_attachments', { sessionId, paths });

export const listSessionAttachments = (sessionId: string): Promise<ContextAttachment[]> =>
  invoke<ContextAttachment[]>('list_session_attachments', { sessionId });

export const removeSessionAttachment = (sessionId: string, attachmentId: string): Promise<void> =>
  invoke('remove_session_attachment', { sessionId, attachmentId });

export const validateSessionAttachments = (
  sessionId: string,
): Promise<ContextAttachmentValidation[]> =>
  invoke<ContextAttachmentValidation[]>('validate_session_attachments', { sessionId });

export const listTurnArtifacts = (
  sessionId: string,
  turnId?: string | null,
): Promise<Artifact[]> =>
  invoke<Artifact[]>('list_turn_artifacts', { sessionId, turnId: turnId ?? null });

export const readArtifact = (sessionId: string, artifactId: string): Promise<ArtifactContent> =>
  invoke<ArtifactContent>('read_artifact', { sessionId, artifactId });

export const listProjectActions = (workspaceId: string): Promise<ProjectAction[]> =>
  invoke<ProjectAction[]>('list_project_actions', { workspaceId });

export const saveProjectAction = (input: {
  workspaceId: string;
  actionId?: string | null;
  name: string;
  kind: ProjectActionKind;
  program: string;
  args: string[];
  cwd?: string | null;
  enabled?: boolean;
}): Promise<ProjectAction> =>
  invoke<ProjectAction>('save_project_action', {
    workspaceId: input.workspaceId,
    actionId: input.actionId ?? null,
    name: input.name,
    kind: input.kind,
    program: input.program,
    args: input.args,
    cwd: input.cwd ?? null,
    enabled: input.enabled ?? true,
  });

export const deleteProjectAction = (workspaceId: string, actionId: string): Promise<void> =>
  invoke('delete_project_action', { workspaceId, actionId });

export const runProjectAction = (
  workspaceId: string,
  actionId: string,
  sessionId?: string | null,
): Promise<ProjectActionRun> =>
  invoke<ProjectActionRun>('run_project_action', {
    workspaceId,
    actionId,
    sessionId: sessionId ?? null,
  });

export const listProjectActionRuns = (
  workspaceId: string,
  limit = 10,
): Promise<ProjectActionRun[]> =>
  invoke<ProjectActionRun[]>('list_project_action_runs', { workspaceId, limit });

export const listCodexThreads = (workspaceId: string): Promise<CodexThreadSummary[]> =>
  invoke<CodexThreadSummary[]>('list_codex_threads', { workspaceId });

export const readCodexThread = (sessionId: string): Promise<CodexThreadSnapshot> =>
  invoke<CodexThreadSnapshot>('read_codex_thread', { sessionId });

export const forkCodexThread = (
  sessionId: string,
  throughTurnId?: string | null,
): Promise<Session> =>
  invoke<Session>('fork_codex_thread', { sessionId, throughTurnId: throughTurnId ?? null });

export const archiveCodexThread = (sessionId: string): Promise<Session> =>
  invoke<Session>('archive_codex_thread', { sessionId });

export const unarchiveCodexThread = (sessionId: string): Promise<Session> =>
  invoke<Session>('unarchive_codex_thread', { sessionId });

export const createCodexSession = (
  workspaceId: string,
  _requestedProfile?: ExecutionProfile | null,
): Promise<Session> =>
  createAgentSession(workspaceId, 'dev.aibo.codex.agent');

export const sendCodexPrompt = (sessionId: string, input: string): Promise<Session> =>
  invoke<Session>('send_codex_prompt', { sessionId, input });

export const abortCodexTurn = (sessionId: string): Promise<void> =>
  invoke('abort_codex_turn', { sessionId });

export const resolveCodexApproval = (
  sessionId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<void> => invoke('resolve_codex_approval', { sessionId, requestId, decision });

export const resolvePiApproval = (
  sessionId: string,
  requestId: string,
  decision: ApprovalDecision,
): Promise<void> => invoke('resolve_pi_approval', { sessionId, requestId, decision });

export const closeCodexSession = (sessionId: string): Promise<void> =>
  invoke('close_codex_session', { sessionId });

export const createPiSession = (
  workspaceId: string,
  _requestedProfile?: ExecutionProfile | null,
): Promise<Session> =>
  createAgentSession(workspaceId, 'dev.aibo.pi.agent');

export const sendPiPrompt = (sessionId: string, input: string): Promise<Session> =>
  invoke<Session>('send_pi_prompt', { sessionId, input });

export const abortPiTurn = (sessionId: string): Promise<void> =>
  invoke('abort_pi_turn', { sessionId });

export const closePiSession = (sessionId: string): Promise<void> =>
  invoke('close_pi_session', { sessionId });

export const steerPiPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('steer_pi_prompt', { sessionId, input });

export const followUpPiPrompt = (sessionId: string, input: string): Promise<void> =>
  invoke('follow_up_pi_prompt', { sessionId, input });

export const clearPiQueue = (sessionId: string): Promise<void> =>
  invoke('clear_pi_queue', { sessionId });

export const getPiSessionTree = (sessionId: string): Promise<PiSessionTreeSnapshot> =>
  invoke<PiSessionTreeSnapshot>('get_pi_session_tree', { sessionId });

export const navigatePiSessionTree = (
  sessionId: string,
  entryId: string,
  options: PiTreeNavigationOptions,
): Promise<PiSessionTreeNavigation> =>
  invoke<PiSessionTreeNavigation>('navigate_pi_session_tree', {
    sessionId,
    entryId,
    summarize: options.mode !== 'none',
    customInstructions: options.mode === 'custom' ? options.customInstructions?.trim() || null : null,
    replaceInstructions: false,
  });

export const getPiSessionSnapshot = (sessionId: string): Promise<PiSessionSnapshot> =>
  invoke<PiSessionSnapshot>('get_pi_session_snapshot', { sessionId });

export const listenToAgentEvents = (
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> => listen<AgentEvent>('agent-event', (event) => handler(event.payload));
