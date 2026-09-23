import type { PresentationGit, PresentationGitAction } from '../../../packages/plugin-protocol/src/presentation-git';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { createActionDirectory } from './action-directory.ts';

type Spec = Omit<PresentationGitAction, 'token'>;
export function gitActions(state: PresentationGit): Spec[] {
  const actions: Spec[] = [];
  const add = (operation: Spec['operation'], args: Spec['args'] = [], event: Spec['event'] = 'click') => actions.push({ operation, args, event });
  add('togglePanel'); add('selectView', ['git']); add('selectView', ['context']);
  if (state.preview.selectedPath !== null || state.preview.fileDiff || state.preview.loading || state.preview.error) add('closeDiff');
  const workspace = state.workspace;
  if (!workspace || !state.desktop) return actions;
  if (!state.loading) add('refresh');
  if (state.repositories) {
    add('repositorySearch', [], 'input');
    if (!state.operationBusy) {
      add('selectRepository', [null]);
      for (const repo of state.repositories) add('selectRepository', [repo.id]);
    }
    if (state.discoveryLimited && !state.loading) add('continueDiscovery');
    for (const repo of state.repositories) {
      add('toggleRepository', [repo.id]);
      if (state.repositoryId !== null) continue;
      const writable = workspace.trust === 'trusted' && !state.operationBusy;
      const changes = repo.changes?.workspaceId === workspace.id && repo.changes.captureStatus === 'captured' && !repo.error ? repo.changes : null;
      for (const file of changes?.files ?? []) {
        if (file.staged && !file.conflicted) { add('repositoryDiff', [repo.id, file.path, 'staged']); if (writable) add('repositoryUnstage', [repo.id, file.path]); }
        if (file.unstaged || file.untracked || file.conflicted) { add('repositoryDiff', [repo.id, file.path, 'unstaged']); if (writable) add('repositoryStage', [repo.id, file.path]); }
      }
      if (writable && changes?.files.some(file => file.unstaged || file.untracked || file.conflicted)) add('repositoryStageAll', [repo.id]);
      if (writable && changes?.files.some(file => file.staged)) add('repositoryUnstageAll', [repo.id]);
    }
    if (state.repositoryId === null) { add('selectSection', ['history']); return actions; }
  }
  if (!state.metadataLoading) add('refreshMetadata');
  add('selectSection', ['changes']); add('selectSection', ['history']);
  if (state.canRequestReview && !state.reviewBusy) add('requestReview');
  const changes = state.changes?.workspaceId === workspace.id && state.changes.captureStatus === 'captured' ? state.changes : null;
  const writable = workspace.trust === 'trusted' && !state.operationBusy;
  for (const file of changes?.files ?? []) {
    if (file.staged && !file.conflicted) {
      add('openDiff', [file.path, 'staged']);
      if (writable) add('unstageFile', [file.path]);
    }
    if (file.unstaged || file.untracked || file.conflicted) {
      add('openDiff', [file.path, 'unstaged']);
      if (writable) add('stageFile', [file.path]);
    }
  }
  if (writable && changes) {
    add('commitMessage', [], 'input'); add('branchDraft', [], 'input');
    if (changes.files.some(file => file.unstaged || file.untracked || file.conflicted)) add('stageAll');
    if (changes.files.some(file => file.staged)) add('unstageAll');
    if (state.draft.commitMessage.trim()) add('commit', [state.draft.commitMessage.trim()]);
    if (state.draft.branchDraft.trim()) add('createBranch', [state.draft.branchDraft.trim()]);
    for (const branch of state.branches) if (!branch.current) add('checkoutBranch', [branch.name]);
    add('saveStash');
    for (const stash of state.stashes) add('applyStash', [stash.reference]);
    if (state.remoteStatus?.behind) add('pull');
    if (state.remoteStatus?.ahead) add('push');
  }
  if (state.remoteStatus && !state.operationBusy) add('fetch');
  for (const commit of state.history) add('selectCommit', [commit.hash]);
  if (state.repositoryId !== null && state.historyHasMore && !state.historyLoadingMore && !state.metadataLoading) add('loadMoreHistory');
  const files = state.commitFiles;
  if (files && files.commit === state.draft.selectedCommit && state.history.some(commit => commit.hash === files.commit)) {
    if (files.files.length < files.total && !state.commitFilesLoading) add('loadMoreCommitFiles', [files.commit]);
    for (const file of files.files) add('openCommitDiff', [files.commit, file.path]);
  }
  return actions;
}
export function createGitDirectory() {
  const directory = createActionDirectory<Spec>('git');
  const scope = (state: PresentationGit) => JSON.stringify([state.workspace?.id ?? null, state.sessionId, state.repositoryId ?? null]);
  return {
    project: (state: PresentationGit) => directory.project(gitActions(state), scope(state)),
    resolve: (state: PresentationGit, context: PresentationContext, intent: PresentationIntent) => directory.resolve(gitActions(state), scope(state), context, intent),
  };
}
