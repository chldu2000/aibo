import {nativeListMessages} from './turn-change-presentation.ts';
import { localizedMessage, translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText } from '../../../packages/i18n/index.js';
import type {
  WorkspaceChanges, WorkspaceFileDiff, GitBranch, GitCommit, GitCommitFileList,
  GitRemoteStatus, GitStashEntry, GitWorkspaceAction, GitSyncAction,
  GitWorkspaceActionResult, GitFileActionResult, GitCommitResult, ExecutionProfile, Session,
} from '../types';
import type { GitRepositoryDiscovery, GitRepositoryState } from '../../../packages/plugin-protocol/src/presentation-git';
import { toErrorText, readNativeMessage } from './error-utils.ts';
import { workspaceFileDiffPresentation } from './workspace-file-diff.ts';
import { repositoryDraftKey, readRepositoryViews, writeRepositoryViews } from './git-repository-state.ts';
import { emptyGitPanelState, readWorkbenchDrafts, writeWorkbenchDrafts, type GitPanelState } from './workbench-drafts.ts';
import type { SetNotice } from './notifications';

export type WorkspaceGitPorts = {
  listWorkspaceGitRepositories(workspace: string, budget: number): Promise<GitRepositoryDiscovery & {localizedWarnings?: unknown}>;
  getWorkspaceChanges(workspace: string, repository?: string): Promise<WorkspaceChanges>;
  getWorkspaceFileDiff(workspace: string, path: string, staged: boolean, repository?: string): Promise<WorkspaceFileDiff>;
  listWorkspaceGitBranches(workspace: string, repository?: string): Promise<GitBranch[]>;
  listWorkspaceGitHistory(workspace: string, limit: number, repository?: string, offset?: number): Promise<GitCommit[]>;
  getWorkspaceGitRemoteStatus(workspace: string, repository?: string): Promise<GitRemoteStatus>;
  listWorkspaceGitStashes(workspace: string, repository?: string): Promise<GitStashEntry[]>;
  listWorkspaceGitCommitFiles(workspace: string, commit: string, offset: number, limit: number, repository?: string): Promise<GitCommitFileList>;
  getWorkspaceGitCommitFileDiff(workspace: string, commit: string, path: string, repository?: string): Promise<WorkspaceFileDiff>;
  checkoutWorkspaceGitBranch(workspace: string, branch: string, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  createWorkspaceGitBranch(workspace: string, branch: string, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  syncWorkspaceGit(workspace: string, action: GitSyncAction, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  stashWorkspaceGit(workspace: string, message?: string, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  applyWorkspaceGitStash(workspace: string, reference: string, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  applyWorkspaceGitFileAction(workspace: string, path: string, action: 'stage' | 'unstage', request?: string, repository?: string): Promise<GitFileActionResult>;
  applyWorkspaceGitAction(workspace: string, action: GitWorkspaceAction, request?: string, repository?: string): Promise<GitWorkspaceActionResult>;
  commitWorkspaceChanges(workspace: string, message: string, request?: string, repository?: string): Promise<GitCommitResult>;
};

export type WorkspaceGitState = {
  workspaceId: string | null;
  repositories: (Omit<GitRepositoryState, 'error' | 'changes'> & { error: LocalizedText | null; changes: WorkspaceChanges | null })[];
  repositoryId: string | null;
  repositorySearch: string;
  repositoryPickerOpen: boolean;
  collapsedRepositories: string[];
  discoveryLimited: boolean;
  discoveryWarnings: LocalizedText[];
  changes: WorkspaceChanges | null;
  loading: boolean;
  error: LocalizedText | null;
  branches: GitBranch[];
  history: GitCommit[];
  historyHasMore: boolean;
  historyLoadingMore: boolean;
  historyLoadMoreError: LocalizedText | null;
  metadataLoading: boolean;
  metadataError: LocalizedText | null;
  commitFiles: GitCommitFileList | null;
  commitFilesLoading: boolean;
  remoteStatus: GitRemoteStatus | null;
  stashes: GitStashEntry[];
  operationBusy: boolean;
  reviewBusy: boolean;
  draft: GitPanelState;
  previewRepositoryId: string | null;
  fileDiff: WorkspaceFileDiff | null;
  fileDiffLoading: boolean;
  fileDiffError: LocalizedText | null;
  fileDiffPath: string | null;
  fileDiffStaged: boolean;
  fileDiffContextLabel: LocalizedText | null;
};
export function workspaceChangesPresentation(changes: WorkspaceChanges | null, locale: Locale): Omit<WorkspaceChanges, 'localizedCaptureError'> | null {
  if (!changes) return null;
  const { localizedCaptureError, ...value } = changes;
  return { ...value, captureError: value.captureError === null ? null : translateMessage(locale, readNativeMessage(localizedCaptureError) ?? value.captureError) };
}
export function workspaceGitPresentation(state: WorkspaceGitState, locale: Locale) {
  const text = (value: LocalizedText | null) => value === null ? null : translateMessage(locale, value);
  return { ...state, changes:workspaceChangesPresentation(state.changes,locale), discoveryWarnings:state.discoveryWarnings.map(value=>translateMessage(locale,value)), repositories: state.repositories.map(repo => ({ ...repo, changes:workspaceChangesPresentation(repo.changes,locale), error: text(repo.error) })),
    error: text(state.error), metadataError: text(state.metadataError), historyLoadMoreError: text(state.historyLoadMoreError),
    fileDiff: workspaceFileDiffPresentation(state.fileDiff, locale),
    fileDiffError: text(state.fileDiffError), fileDiffContextLabel: text(state.fileDiffContextLabel) };
}
export const emptyWorkspaceGit = (): WorkspaceGitState => ({
  workspaceId: null, repositories: [], repositoryId: null, repositorySearch: '', repositoryPickerOpen: false,
  collapsedRepositories: [], discoveryLimited: false, discoveryWarnings: [], changes: null, loading: false, error: null,
  branches: [], history: [], historyHasMore: false, historyLoadingMore: false, historyLoadMoreError: null,
  metadataLoading: false, metadataError: null, commitFiles: null, commitFilesLoading: false,
  remoteStatus: null, stashes: [], operationBusy: false, reviewBusy: false, draft: emptyGitPanelState(),
  previewRepositoryId: null, fileDiff: null, fileDiffLoading: false, fileDiffError: null,
  fileDiffPath: null, fileDiffStaged: false, fileDiffContextLabel: null,
});

type ReviewContext = { session: Session | null; running: boolean; profile: ExecutionProfile | null };
export type GitReview = { workspaceId: string; session: Session; profile: ExecutionProfile; prompt: string };
type Options = {
  api: WorkspaceGitPorts;
  desktop(): boolean;
  changed(state: WorkspaceGitState): void;
  error(message: LocalizedText | null): void;
  notice: SetNotice;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  windowId: string;
  reviewContext(): ReviewContext;
  startReview(review: GitReview): Promise<void>;
};

/** Host-owned Git state shared by every presentation. Reads belong to a view
 * epoch; writes retain their original target and settle independently of it. */
export function createWorkspaceGitController(options: Options) {
  const api = options.api;
  let state = emptyWorkspaceGit();
  let views = readRepositoryViews(options.storage, options.windowId);
  const drafts = readWorkbenchDrafts(options.storage, options.windowId);
  let epoch = 0, changesRequest = 0, metadataRequest = 0, previewRequest = 0, commitRequest = 0;
  let changesBackground: number | null = null, metadataBackground: number | null = null;
  let historyOffset = 0, scanBudget = 2000;
  let lastMetadataPollAt = 0;
  let pendingSection: GitPanelState['gitSection'] | undefined;
  const historyPageSize = 16;
  function set(patch: Partial<WorkspaceGitState>) {
    state = { ...state, ...patch };
    options.changed(state);
  }
  const current = (workspace: string) => options.desktop() && workspace === state.workspaceId;
  const viewCurrent = (workspace: string, repository: string, viewEpoch: number) =>
    current(workspace) && repository === state.repositoryId && viewEpoch === epoch;
  function saveViews() { writeRepositoryViews(options.storage, options.windowId, views); }
  function draftFor(workspace: string, repository: string | null) {
    return drafts.git[repositoryDraftKey(workspace, repository)] ?? emptyGitPanelState();
  }
  function saveDraft(workspace: string, repository: string | null, draft: GitPanelState) {
    drafts.git[repositoryDraftKey(workspace, repository)] = { ...draft };
    writeWorkbenchDrafts(options.storage, options.windowId, drafts);
    if (workspace === state.workspaceId && repository === state.repositoryId) set({ draft: { ...draft } });
  }
  function changeDraft(patch: Partial<GitPanelState>) {
    if (state.workspaceId) saveDraft(state.workspaceId, state.repositoryId, { ...state.draft, ...patch });
  }
  function clearSubmittedDraft(workspace: string, repository: string, field: 'branchDraft' | 'commitMessage', submitted: string) {
    const draft = draftFor(workspace, repository);
    if (draft[field].trim() === submitted.trim()) saveDraft(workspace, repository, { ...draft, [field]: '' });
  }
  function closeWorkspaceFileDiff() {
    ++previewRequest;
    set({ fileDiff: null, fileDiffLoading: false, fileDiffError: null, fileDiffPath: null,
      previewRepositoryId: null, fileDiffStaged: false, fileDiffContextLabel: null });
  }
  function closeWorkspaceCommitFiles() {
    ++commitRequest;
    set({ commitFiles: null, commitFilesLoading: false });
  }
  function resetMetadata() {
    ++metadataRequest;
    metadataBackground = null;
    historyOffset = 0;
    set({ branches: [], history: [], historyHasMore: false, historyLoadingMore: false, historyLoadMoreError: null,
      metadataLoading: false, metadataError: null, remoteStatus: null, stashes: [] });
    closeWorkspaceCommitFiles();
    closeWorkspaceFileDiff();
  }
  function selectWorkspace(workspaceId: string | null) {
    if (state.workspaceId === workspaceId) return;
    ++epoch; ++changesRequest; ++metadataRequest; ++previewRequest; ++commitRequest;
    changesBackground = metadataBackground = null;
    historyOffset = 0; scanBudget = 2000; pendingSection = undefined; lastMetadataPollAt = 0;
    const remembered = workspaceId ? views[workspaceId] : undefined;
    const repositoryId = remembered?.selected ?? null;
    // A navigation change revokes reads, never the independently pending write.
    set({ ...emptyWorkspaceGit(), workspaceId, repositoryId, collapsedRepositories: remembered?.collapsed ?? [],
      draft: workspaceId ? draftFor(workspaceId, repositoryId) : emptyGitPanelState(),
      operationBusy: state.operationBusy, reviewBusy: state.reviewBusy });
  }
  function toggleRepository(id: string) {
    const workspace = state.workspaceId;
    if (!workspace) return;
    const view = views[workspace] ?? { selected: null, collapsed: [] };
    const collapsed = view.collapsed.includes(id) ? view.collapsed.filter(value => value !== id) : [...view.collapsed, id];
    views = { ...views, [workspace]: { ...view, collapsed } };
    saveViews(); set({ collapsedRepositories: collapsed });
  }
  function selectRepository(id: string | null, section?: GitPanelState['gitSection']) {
    const workspace = state.workspaceId;
    if (!workspace || state.operationBusy || (id !== null && !state.repositories.some(repo => repo.id === id))) return;
    ++epoch;
    views = { ...views, [workspace]: { ...views[workspace], selected: id, collapsed: state.collapsedRepositories } };
    saveViews(); resetMetadata();
    set({ repositoryId: id, changes: state.repositories.find(repo => repo.id === id)?.changes ?? null,
      repositoryPickerOpen: false, draft: draftFor(workspace, id) });
    section ??= pendingSection; pendingSection = undefined;
    if (id !== null) {
      if (section) changeDraft({ gitSection: section });
      void refreshWorkspaceGitMetadata(workspace);
      restoreRepositoryFile(workspace, id);
    }
  }
  function selectSection(section: GitPanelState['gitSection']) {
    if (state.repositoryId === null) { pendingSection = section; set({ repositoryPickerOpen: true }); return; }
    changeDraft({ gitSection: section });
    if (section === 'history' && !state.history.length && !state.metadataLoading && state.workspaceId)
      void refreshWorkspaceGitMetadata(state.workspaceId);
  }
  function restoreRepositoryFile(workspace: string, repository: string) {
    const saved = views[workspace]?.files?.[repository];
    if (saved && state.repositories.find(repo => repo.id === repository)?.changes?.files.some(file =>
      file.path === saved.path && (saved.staged ? file.staged : file.unstaged || file.untracked || file.conflicted)))
      void openWorkspaceFileDiff(workspace, saved.path, saved.staged, repository);
  }
  async function refreshWorkspaceChanges(workspace: string, background = false) {
    if (!current(workspace) || (background && (state.loading || changesBackground !== null))) return;
    const request = ++changesRequest;
    const restoringWorkspace = state.repositories.length === 0;
    const live = () => current(workspace) && request === changesRequest;
    if (background) changesBackground = request;
    set({ loading: background ? state.loading : true, error: null });
    try {
      const discovery = await api.listWorkspaceGitRepositories(workspace, scanBudget);
      if (!live()) return;
      const repositories = discovery.repositories.map(repo => ({ ...repo,
        changes: state.repositories.find(old => old.id === repo.id)?.changes ?? null, error: null }));
      const remembered = views[workspace];
      const selected = remembered && (remembered.selected === null || repositories.some(repo => repo.id === remembered.selected))
        ? remembered.selected : repositories.length === 1 ? repositories[0].id : null;
      if (!remembered || selected !== remembered.selected) {
        ++epoch;
        views = { ...views, [workspace]: { ...remembered, selected, collapsed: remembered?.collapsed ?? [] } };
        saveViews(); resetMetadata();
      }
      set({ repositories, repositoryId: selected, discoveryLimited: discovery.limited, discoveryWarnings: nativeListMessages(discovery.warnings,discovery.localizedWarnings),
        collapsedRepositories: views[workspace].collapsed, draft: draftFor(workspace, selected),
        changes: repositories.find(repo => repo.id === selected)?.changes ?? null });
      // Publish discovery first, then bounded batches; each repository settles separately.
      for (let offset = 0; offset < repositories.length && live(); offset += 4) {
        await Promise.all(repositories.slice(offset, offset + 4).map(async repo => {
          let changes: WorkspaceChanges | null = null, error: LocalizedText | null = null;
          try { changes = await api.getWorkspaceChanges(workspace, repo.id); }
          catch (failure) { error = toErrorText(failure); }
          if (!live()) return;
          const next = state.repositories.map(item => item.id === repo.id ? { ...item, changes, error } : item);
          set({ repositories: next, changes: next.find(item => item.id === state.repositoryId)?.changes ?? null });
        }));
      }
      if (live() && state.repositoryId !== null) {
        if (!background) void refreshWorkspaceGitMetadata(workspace);
        if (restoringWorkspace) restoreRepositoryFile(workspace, state.repositoryId);
      }
    } catch (error) {
      if (live() && !background) set({ changes: null, error: toErrorText(error) });
    } finally {
      if (live()) set({ loading: false });
      if (changesBackground === request) changesBackground = null;
    }
  }
  async function continueDiscovery() {
    scanBudget = Math.min(scanBudget * 4, 100000);
    if (state.workspaceId) await refreshWorkspaceChanges(state.workspaceId);
  }
  function refreshVisible(forceMetadata = false, now = Date.now()) {
    if (!state.workspaceId) return;
    void refreshWorkspaceChanges(state.workspaceId, true);
    if (forceMetadata || now - lastMetadataPollAt >= 5000) {
      lastMetadataPollAt = now;
      void refreshWorkspaceGitMetadata(state.workspaceId, true);
    }
  }
  async function openWorkspaceFileDiff(workspace: string, path: string, staged: boolean, explicitRepository?: string) {
    const repository = explicitRepository ?? state.repositoryId;
    if (!current(workspace) || !repository) return;
    const view = views[workspace] ?? { selected: null, collapsed: [] };
    views = { ...views, [workspace]: { ...view, files: { ...view.files, [repository]: { path, staged } } } };
    saveViews();
    await readDiff(workspace, repository, path, staged,
      `${state.repositories.find(repo => repo.id === repository)?.name ?? ''} · ${path}`,
      () => api.getWorkspaceFileDiff(workspace, path, staged, repository));
  }
  async function readDiff(workspace: string, repository: string, path: string, staged: boolean, label: LocalizedText, read: () => Promise<WorkspaceFileDiff>) {
    const request = ++previewRequest;
    const viewEpoch = epoch;
    const live = () => current(workspace) && request === previewRequest && viewEpoch === epoch;
    set({ previewRepositoryId: repository, fileDiffPath: path, fileDiffStaged: staged,
      fileDiffContextLabel: label, fileDiff: null, fileDiffLoading: true, fileDiffError: null });
    try { const fileDiff = await read(); if (live()) set({ fileDiff }); }
    catch (error) { if (live()) set({ fileDiffError: toErrorText(error) }); }
    finally { if (live()) set({ fileDiffLoading: false }); }
  }
  async function refreshWorkspaceGitMetadata(workspace: string, background = false) {
    const repository = state.repositoryId;
    if (!current(workspace) || !repository || (background && (state.metadataLoading || metadataBackground !== null || state.historyLoadingMore))) return;
    const request = ++metadataRequest, viewEpoch = epoch;
    const live = () => viewCurrent(workspace, repository, viewEpoch) && request === metadataRequest;
    if (background) metadataBackground = request;
    set({ metadataLoading: background ? state.metadataLoading : true, historyLoadingMore: false,
      metadataError: null, historyLoadMoreError: null });
    try {
      const [branches, page, remoteStatus, stashes] = await Promise.all([
        api.listWorkspaceGitBranches(workspace, repository), api.listWorkspaceGitHistory(workspace, historyPageSize + 1, repository),
        api.getWorkspaceGitRemoteStatus(workspace, repository), api.listWorkspaceGitStashes(workspace, repository),
      ]);
      if (!live()) return;
      const newest = page.slice(0, historyPageSize), last = newest.at(-1)?.hash;
      const previous = last && page.length > historyPageSize && state.history.length > historyPageSize
        ? state.history.findIndex(commit => commit.hash === last) : -1;
      const history = previous >= 0 ? [...newest, ...state.history.slice(previous + 1)] : newest;
      historyOffset = history.length;
      set({ branches, history, historyHasMore: previous >= 0 ? state.historyHasMore : page.length > historyPageSize, remoteStatus, stashes });
    } catch (error) { if (live() && !background) set({ metadataError: toErrorText(error) }); }
    finally {
      if (live()) set({ metadataLoading: false });
      if (metadataBackground === request) metadataBackground = null;
    }
  }
  async function loadMoreWorkspaceGitHistory(workspace: string) {
    const repository = state.repositoryId;
    if (!current(workspace) || !repository || !state.historyHasMore || state.historyLoadingMore || state.metadataLoading) return;
    const request = ++metadataRequest, viewEpoch = epoch, offset = historyOffset;
    const live = () => viewCurrent(workspace, repository, viewEpoch) && request === metadataRequest;
    set({ historyLoadingMore: true, historyLoadMoreError: null });
    try {
      const page = await api.listWorkspaceGitHistory(workspace, historyPageSize + 1, repository, offset);
      if (!live()) return;
      const next = page.slice(0, historyPageSize), seen = new Set(state.history.map(commit => commit.hash));
      historyOffset = offset + next.length;
      set({ history: [...state.history, ...next.filter(commit => !seen.has(commit.hash))], historyHasMore: page.length > historyPageSize });
    } catch (error) { if (live()) set({ historyLoadMoreError: toErrorText(error) }); }
    finally { if (live()) set({ historyLoadingMore: false }); }
  }
  async function loadWorkspaceCommitFiles(workspace: string, commit: string, append = false) {
    const repository = state.repositoryId;
    if (!current(workspace) || !repository || (append && state.commitFilesLoading)) return;
    const request = ++commitRequest, viewEpoch = epoch;
    const live = () => viewCurrent(workspace, repository, viewEpoch) && request === commitRequest;
    const offset = append && state.commitFiles?.commit === commit ? state.commitFiles.files.length : 0;
    set({ commitFilesLoading: true, metadataError: null, commitFiles: append ? state.commitFiles : null });
    try {
      const result = await api.listWorkspaceGitCommitFiles(workspace, commit, offset, 10, repository);
      if (live()) set({ commitFiles: append && state.commitFiles?.commit === commit
        ? { ...result, files: [...state.commitFiles.files, ...result.files] } : result });
    } catch (error) { if (live()) set({ metadataError: toErrorText(error) }); }
    finally { if (live()) set({ commitFilesLoading: false }); }
  }
  async function openWorkspaceCommitFileDiff(workspace: string, commit: string, path: string) {
    const repository = state.repositoryId;
    if (!current(workspace) || !repository) return;
    await readDiff(workspace, repository, path, false,
      localizedMessage('git.commitPreviewTitle', {repository: state.repositories.find(repo => repo.id === repository)?.name ?? '', commit: commit.slice(0, 8), path}),
      () => api.getWorkspaceGitCommitFileDiff(workspace, commit, path, repository));
  }
  async function write(workspace: string, repository: string | null, operation: (repository: string) => Promise<{ ok: boolean; message: LocalizedText; notice: LocalizedText }>, settled?: () => void, closeDiff = false) {
    if (!current(workspace) || !repository || state.operationBusy) return false;
    const viewEpoch = epoch;
    set({ operationBusy: true }); options.error(null);
    try {
      const result = await operation(repository);
      if (!result.ok) { options.error(result.message); return false; }
      settled?.();
      options.notice(result.notice, 'success');
      // The write result survives navigation. Only its originating view may refresh/close.
      if (viewCurrent(workspace, repository, viewEpoch) || (current(workspace) && epoch === viewEpoch)) {
        await refreshWorkspaceChanges(workspace);
        if (viewCurrent(workspace, repository, viewEpoch)) {
          await refreshWorkspaceGitMetadata(workspace);
          if (closeDiff && viewCurrent(workspace, repository, viewEpoch)) closeWorkspaceFileDiff();
        }
      }
      return true;
    } catch (error) { options.error(toErrorText(error)); return false; }
    finally { set({ operationBusy: false }); }
  }
  const applied = (result: GitWorkspaceActionResult | GitFileActionResult, notice: LocalizedText) => ({ ok: result.applied, message: ('localizedMessage' in result ? readNativeMessage(result.localizedMessage) : null) ?? result.message, notice });
  const checkoutWorkspaceBranch = (workspace: string, branch: string) => write(workspace, state.repositoryId,
    async repository => applied(await api.checkoutWorkspaceGitBranch(workspace, branch, undefined, repository), localizedMessage('git.branchSwitched', {branch})), undefined, true);
  function createWorkspaceBranch(workspace: string, branch: string) {
    const repository = state.repositoryId;
    return write(workspace, repository,
      async id => applied(await api.createWorkspaceGitBranch(workspace, branch, undefined, id), localizedMessage('git.branchCreated', {branch})),
      () => clearSubmittedDraft(workspace, repository!, 'branchDraft', branch), true);
  }
  const syncWorkspaceBranch = (workspace: string, action: GitSyncAction) => write(workspace, state.repositoryId,
    async repository => applied(await api.syncWorkspaceGit(workspace, action, undefined, repository),
      action === 'fetch' ? localizedMessage('git.fetched') : action === 'pull' ? localizedMessage('git.pulled') : localizedMessage('git.pushed')));
  const saveWorkspaceStash = (workspace: string) => write(workspace, state.repositoryId,
    async repository => applied(await api.stashWorkspaceGit(workspace, undefined, undefined, repository), localizedMessage('git.stashSaved')));
  const applyWorkspaceStash = (workspace: string, reference: string) => write(workspace, state.repositoryId,
    async repository => applied(await api.applyWorkspaceGitStash(workspace, reference, undefined, repository), localizedMessage('git.stashApplied', {reference})));
  const applyWorkspaceGitAction = (workspace: string, path: string, action: 'stage' | 'unstage', repository?: string) => write(workspace, repository ?? state.repositoryId,
    async id => applied(await api.applyWorkspaceGitFileAction(workspace, path, action, undefined, id), action === 'stage' ? localizedMessage('git.fileStaged', {path}) : localizedMessage('git.fileUnstaged', {path})));
  const applyWorkspaceGitWorkspaceAction = (workspace: string, action: GitWorkspaceAction, repository?: string) => write(workspace, repository ?? state.repositoryId,
    async id => applied(await api.applyWorkspaceGitAction(workspace, action, undefined, id),
      { stage_all: localizedMessage('git.allStaged'), stage_changed: localizedMessage('git.changedStaged'), stage_untracked: localizedMessage('git.untrackedStaged'), unstage_all: localizedMessage('git.allUnstaged') }[action]));
  function commitWorkspaceGitChanges(workspace: string, message: string) {
    const repository = state.repositoryId;
    return write(workspace, repository, async id => {
      const result = await api.commitWorkspaceChanges(workspace, message, undefined, id);
      return { ok: result.committed, message: readNativeMessage(result.localizedMessage) ?? result.message, notice: result.hash ? localizedMessage('git.commitCreatedHash', {hash: result.hash.slice(0, 8)}) : localizedMessage('git.commitCreated') };
    }, () => clearSubmittedDraft(workspace, repository!, 'commitMessage', message), true);
  }
  async function requestWorkspaceAgentReview(workspace: string) {
    const repository = state.repositoryId;
    if (!current(workspace) || !repository) return;
    const { session, running, profile } = options.reviewContext();
    if (!session || session.workspaceId !== workspace || session.archived) {
      options.error(localizedMessage('git.reviewSessionRequired')); return;
    }
    if (running || state.reviewBusy) return;
    set({ reviewBusy: true }); options.error(null);
    try {
      const reviewProfile: ExecutionProfile = {
        schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none',
        filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'disabled',
        model: profile?.model ?? null, reasoningEffort: profile?.reasoningEffort ?? null,
      };
      const files = state.changes?.workspaceId === workspace ? state.changes.files : [];
      const sections: string[] = [];
      let length = 0;
      const limit = 120_000;
      for (const file of files) {
        for (const staged of file.staged ? [true, ...(file.unstaged ? [false] : [])] : [false]) {
          if (length >= limit) break;
          try {
            const result = await api.getWorkspaceFileDiff(workspace, file.path, staged, repository);
            if (!result.available || !result.diff) continue;
            const section = `\n\n### ${staged ? '暂存区' : '工作区'}：${file.path}\n${result.diff}`;
            sections.push(section.slice(0, limit - length));
            length += Math.min(section.length, limit - length);
          } catch { /* One unreadable file does not discard other review evidence. */ }
        }
      }
      const prompt = [
        '请审查当前工作区的 Git 变更。',
        '重点关注正确性、潜在回归、安全风险和缺失的测试；按优先级列出具体文件与行号，并在没有问题时明确说明。',
        '这是一个受执行策略约束的只读审查会话。请仅根据下方 diff 审查，不要尝试修改文件或执行命令。',
        sections.length ? sections.join('') : '当前没有可供审查的文本 diff。',
        length >= limit ? '\n\n部分 diff 因长度限制已截断。' : '',
      ].join('\n');
      await options.startReview({ workspaceId: workspace, session, profile: reviewProfile, prompt });
      options.notice(localizedMessage('git.reviewRequested'), 'info');
    } catch (error) { options.error(toErrorText(error)); }
    finally { set({ reviewBusy: false }); }
  }
  return {
    get snapshot(): WorkspaceGitState { return state; },
    selectWorkspace, selectRepository, toggleRepository, selectSection, changeDraft,
    searchRepositories: (repositorySearch: string) => set({ repositorySearch }), continueDiscovery, refreshVisible,
    refreshWorkspaceChanges, refreshWorkspaceGitMetadata, loadMoreWorkspaceGitHistory,
    openWorkspaceFileDiff, closeWorkspaceFileDiff, loadWorkspaceCommitFiles, closeWorkspaceCommitFiles,
    openWorkspaceCommitFileDiff, checkoutWorkspaceBranch, createWorkspaceBranch, syncWorkspaceBranch,
    saveWorkspaceStash, applyWorkspaceStash, applyWorkspaceGitAction, applyWorkspaceGitWorkspaceAction,
    commitWorkspaceGitChanges, requestWorkspaceAgentReview,
  };
}
