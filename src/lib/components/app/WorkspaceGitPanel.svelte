<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import type { GitRepositoryState } from '../../../../packages/plugin-protocol/src/presentation-git';
  import type { GitPanelState } from '$lib/app/workbench-drafts';
  import { Badge, Button, Card, FileChangeMark, Icon, Input, RepositorySelect } from '$lib/ui-kit';
  import SidePanelTabs from './SidePanelTabs.svelte';
  import { relativeDateLabel } from './session-utils';
  import type {
    GitBranch,
    GitCommit,
    GitCommitFileList,
    GitRemoteStatus,
    GitStashEntry,
    GitSyncAction,
    GitWorkspaceAction,
    WorkspaceChanges,
    WorkspaceFileChange,
  } from '$lib/types';
  import type { WorkspaceListItem } from './view-types';

  type WorkspaceGitPanelProps = {
    repositories: GitRepositoryState[];
    repositoryId: string | null;
    repositorySearch: string;
    collapsedRepositories: string[];
    discoveryLimited: boolean;
    discoveryWarnings: string[];
    onSelectRepository: (id: string | null, section?: 'changes' | 'history') => void;
    onRepositorySearch: (value: string) => void;
    onToggleRepository: (id: string) => void;
    onContinueDiscovery: () => void;
    draftState: GitPanelState;
    onDraftChange: (state: GitPanelState) => void;
    workspace: WorkspaceListItem | null;
    desktop: boolean;
    changes: WorkspaceChanges | null;
    loading: boolean;
    error: string | null;
    selectedFilePath: string | null;
    previewRepositoryId: string | null;
    selectedFileStaged: boolean;
    branches: GitBranch[];
    history: GitCommit[];
    historyHasMore: boolean;
    historyLoadingMore: boolean;
    historyLoadMoreError: string | null;
    gitMetadataLoading: boolean;
    gitMetadataError: string | null;
    commitFiles: GitCommitFileList | null;
    commitFilesLoading: boolean;
    remoteStatus: GitRemoteStatus | null;
    stashes: GitStashEntry[];
    operationBusy: boolean;
    reviewBusy: boolean;
    canRequestReview: boolean;
    activeView: 'context' | 'git';
    showTabs?: boolean;
    onRefresh: () => void;
    onApplyFileAction: (workspaceId: string, path: string, action: 'stage' | 'unstage', repositoryId?: string) => void;
    onApplyWorkspaceAction: (workspaceId: string, action: GitWorkspaceAction, repositoryId?: string) => void;
    onCommit: (workspaceId: string, message: string) => void | Promise<boolean>;
    onOpenDiff: (workspaceId: string, path: string, staged: boolean, repositoryId?: string) => void;
    onRefreshGitMetadata: (workspaceId: string) => void;
    onLoadMoreHistory: (workspaceId: string) => void;
    onCheckoutBranch: (workspaceId: string, branch: string) => void;
    onCreateBranch: (workspaceId: string, branch: string) => void;
    onSelectCommit: (workspaceId: string, commit: string) => void;
    onLoadMoreCommitFiles: (workspaceId: string, commit: string) => void;
    onOpenCommitFileDiff: (workspaceId: string, commit: string, path: string) => void;
    onSync: (workspaceId: string, action: GitSyncAction) => void;
    onSaveStash: (workspaceId: string) => void;
    onApplyStash: (workspaceId: string, reference: string) => void;
    onRequestReview: (workspaceId: string) => void;
    onSelectView: (view: 'context' | 'git') => void;
  };

  let {
    repositories, repositoryId, repositorySearch, collapsedRepositories, discoveryLimited, discoveryWarnings,
    onSelectRepository, onRepositorySearch, onToggleRepository, onContinueDiscovery,
    draftState, onDraftChange,
    workspace,
    desktop,
    changes,
    loading,
    error,
    selectedFilePath, previewRepositoryId,
    selectedFileStaged,
    branches,
    history,
    historyHasMore,
    historyLoadingMore,
    historyLoadMoreError,
    gitMetadataLoading,
    gitMetadataError,
    commitFiles,
    commitFilesLoading,
    remoteStatus,
    stashes,
    operationBusy,
    reviewBusy,
    canRequestReview,
    activeView, showTabs = true,
    onRefresh,
    onApplyFileAction,
    onApplyWorkspaceAction,
    onCommit,
    onOpenDiff,
    onRefreshGitMetadata,
    onLoadMoreHistory,
    onCheckoutBranch,
    onCreateBranch,
    onSelectCommit,
    onLoadMoreCommitFiles,
    onOpenCommitFileDiff,
    onSync,
    onSaveStash,
    onApplyStash,
    onRequestReview,
    onSelectView,
  }: WorkspaceGitPanelProps = $props();

  const conflictedFiles = $derived(changes?.files.filter((file) => file.conflicted) ?? []);
  const stagedFiles = $derived(changes?.files.filter((file) => file.staged && !file.conflicted) ?? []);
  const changedFiles = $derived(changes?.files.filter((file) => file.unstaged && !file.untracked && !file.conflicted) ?? []);
  const untrackedFiles = $derived(changes?.files.filter((file) => file.untracked && !file.conflicted) ?? []);
  const headLabel = $derived(changes?.head ? changes.head.slice(0, 8) : null);
  const stagedCount = $derived(stagedFiles.length);
  const changeCount = $derived(repositoryId === null ? repositories.reduce((sum, repo) => sum + (repo.changes?.files.length ?? 0), 0) : changes?.files.length ?? 0);
  let repositoryMenuOpen = $state(false);
  let pendingSection = $state<'changes' | 'history' | undefined>(undefined);
  let cleanRepositoriesOpen = $state(false);
  const currentRepository = $derived(repositories.find(repo => repo.id === repositoryId));
  let branchMenuOpen = $state(false);
  let stashMenuOpen = $state(false);
  type ChangeGroupKey = 'conflicted' | 'staged' | 'changed' | 'untracked';
  let expandedChangeGroups = $state<Record<string, boolean>>({});

  let restoredCommitTarget: string | null = null;
  $effect(() => {
    const target = draftState.selectedCommit;
    if (!workspace || !target || gitMetadataLoading || history.length === 0) return;
    if (!history.some(commit => commit.hash === target)) onDraftChange({ ...draftState, selectedCommit: null });
    else if (draftState.gitSection === 'history' && commitFiles?.commit !== target && !commitFilesLoading) {
      const restoreKey = `${workspace.id}:${target}`;
      // A failed restore remains retryable by clicking; do not start a request loop.
      if (restoredCommitTarget !== restoreKey) {
        restoredCommitTarget = restoreKey;
        onSelectCommit(workspace.id, target);
      }
    }
  });

  function toggleChangeGroup(group: ChangeGroupKey, repo: string | undefined): void {
    const key = `${repo ?? repositoryId}:${group}`;
    expandedChangeGroups = { ...expandedChangeGroups, [key]: !(expandedChangeGroups[key] ?? true) };
  }

  function displayPath(file: Pick<WorkspaceFileChange, 'path' | 'previousPath'>): string {
    return file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  }

  function changeLabel(file: { kind: WorkspaceFileChange['kind']; conflicted?: boolean; untracked?: boolean }): string {
    if (file.conflicted) return $t('git.conflicted');
    if (file.untracked || file.kind === 'added') return $t('git.added');
    if (file.kind === 'deleted') return $t('git.deleted');
    if (file.kind === 'renamed') return $t('git.renamed');
    return $t('git.modified');
  }

  function pathName(path: string): string {
    return path.split('/').at(-1) ?? path;
  }

  function pathParent(path: string): string {
    const segments = path.split('/');
    segments.pop();
    return segments.join('/');
  }

  function fileName(file: Pick<WorkspaceFileChange, 'path' | 'previousPath'>): string {
    return file.previousPath
      ? `${pathName(file.previousPath)} → ${pathName(file.path)}`
      : pathName(file.path);
  }

  function fileLocation(file: Pick<WorkspaceFileChange, 'path' | 'previousPath'>): string {
    const currentParent = pathParent(file.path);
    if (!file.previousPath) return currentParent;
    const previousParent = pathParent(file.previousPath);
    return previousParent !== currentParent
      ? `${previousParent || '.'} → ${currentParent || '.'}`
      : currentParent;
  }

  function selectCommit(commit: string): void {
    onDraftChange({ ...draftState, selectedCommit: commit });
    onSelectCommit(workspace!.id, commit);
  }

  function commitTime(value: string): string {
    return relativeDateLabel(value, $locale);
  }

  async function submitCommit(): Promise<void> {
    if (!workspace || workspace.trust !== 'trusted' || operationBusy || stagedCount === 0 || !draftState.commitMessage.trim()) return;
    await onCommit(workspace.id, draftState.commitMessage.trim());
  }

  function selectGitSection(section: 'changes' | 'history'): void {
    if (repositoryId === null && section === 'history') { pendingSection = 'history'; repositoryMenuOpen = true; return; }
    onDraftChange({ ...draftState, gitSection: section });
    branchMenuOpen = false;
    stashMenuOpen = false;
    if (section === 'history' && workspace && history.length === 0 && !gitMetadataLoading) onRefreshGitMetadata(workspace.id);
  }

  function moveGitTab(event: KeyboardEvent): void {
    const current = repositoryId === null || draftState.gitSection === 'changes' ? 'changes' : 'history';
    let next: 'changes' | 'history' | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = current === 'changes' ? 'history' : 'changes';
    if (event.key === 'Home') next = 'changes';
    if (event.key === 'End') next = 'history';
    if (!next) return;
    event.preventDefault();
    selectGitSection(next);
    if (repositoryId !== null || next === 'changes') requestAnimationFrame(() => document.getElementById(`git-${next}-tab`)?.focus());
  }

  function submitBranch(): void {
    if (!workspace || workspace.trust !== 'trusted' || !draftState.branchDraft.trim()) return;
    onCreateBranch(workspace.id, draftState.branchDraft.trim());
    branchMenuOpen = false;
  }
</script>

{#snippet fileGroup(group: ChangeGroupKey, title: string, files: WorkspaceFileChange[], action: 'stage' | 'unstage', repoId: string | undefined = undefined)}
  {#if files.length > 0}
    <section class="git-change-group" aria-label={title}>
      <header class="git-change-group-heading">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="git-change-group-trigger"
          aria-expanded={(expandedChangeGroups[`${repoId ?? repositoryId}:${group}`] ?? true)}
          aria-controls={`git-change-list-${repoId ?? repositoryId}-${group}`}
          onclick={() => toggleChangeGroup(group, repoId)}
        >
          <Icon
            name="chevron-down"
            size={12}
            data-collapsed={!(expandedChangeGroups[`${repoId ?? repositoryId}:${group}`] ?? true) ? 'true' : undefined}
            aria-hidden="true"
          />
          <span class="git-change-group-title">{title}</span>
          <Badge variant="secondary" class="git-change-group-count">{files.length}</Badge>
        </Button>
        {#if group === 'staged' || group === 'changed' || group === 'untracked'}
          <Button variant="ghost" size="icon" class="git-change-group-action" aria-label={group === 'untracked' ? $t('git.stageUntracked') : action === 'stage' ? $t('git.stageChanges') : $t('git.unstageAll')} title={group === 'untracked' ? $t('git.stageUntracked') : action === 'stage' ? $t('git.stageChanges') : $t('git.unstageAll')} disabled={!workspace || workspace.trust !== 'trusted' || operationBusy} onclick={() => workspace && onApplyWorkspaceAction(workspace.id, group === 'changed' ? 'stage_changed' : group === 'untracked' ? 'stage_untracked' : 'unstage_all', repoId)}><Icon name={action === 'stage' ? 'add' : 'undo'} size={14} /></Button>
        {/if}
      </header>
      {#if (expandedChangeGroups[`${repoId ?? repositoryId}:${group}`] ?? true)}
      <div id={`git-change-list-${repoId ?? repositoryId}-${group}`} class="git-change-list" role="list">
          {#each files as file (`${title}:${file.path}`)}
            {@const location = fileLocation(file)}
            {@const stats = action === 'unstage' ? file.stagedStats : file.unstagedStats}
            <div
              class="changeset-file changeset-file-row"
              class:changeset-file-selected={((repoId ?? repositoryId) === previewRepositoryId) && selectedFilePath === file.path && selectedFileStaged === (action === 'unstage')}
              role="listitem"
              aria-current={((repoId ?? repositoryId) === previewRepositoryId) && selectedFilePath === file.path && selectedFileStaged === (action === 'unstage') ? 'true' : undefined}
            >
              <FileChangeMark kind={file.conflicted ? 'conflicted' : file.untracked ? 'added' : file.kind} decorative />
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="changeset-file-button"
                aria-label={$t('git.changedFileLabel', {kind: changeLabel(file), path: file.path})}
                title={$t('git.diff')}
                onclick={() => workspace && onOpenDiff(workspace.id, file.path, action === 'unstage', repoId)}
              >
                <span class="changeset-file-copy" title={displayPath(file)}>
                  <code class:changeset-file-name-only={!location} class="changeset-file-name">{fileName(file)}</code>
                  {#if location}<small class="changeset-file-location">{location}</small>{/if}
                </span>
              </Button>
              <div class="git-file-tail">
              {#if stats}<span class="git-line-stats" aria-label={$t('git.lineStats', {additions: stats.additions, deletions: stats.deletions})}><span>+{stats.additions}</span><span>−{stats.deletions}</span></span>{/if}
              <div class="changeset-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={action === 'stage' ? $t('git.stageFile', {path: file.path}) : $t('git.unstageFile', {path: file.path})}
                  title={action === 'stage' ? $t('git.stageChange') : $t('git.unstage')}
                  disabled={!workspace || workspace.trust !== 'trusted' || operationBusy}
                  onclick={() => workspace && onApplyFileAction(workspace.id, file.path, action, repoId)}
                >
                  {action === 'stage' ? $t('git.stage') : $t('git.unstage')}
                </Button>
              </div>
              </div>
            </div>
          {/each}
      </div>
      {/if}
    </section>
  {/if}
{/snippet}

{#snippet repositoryGroup(repo: GitRepositoryState)}
  <section class="git-change-group" aria-label={$t('git.repositoryLabel', {name: repo.name, path: repo.relativePath})}>
    <header class="git-change-group-heading">
      <Button variant="ghost" size="sm" aria-expanded={!collapsedRepositories.includes(repo.id)} onclick={() => onToggleRepository(repo.id)}>
        <Icon name="chevron-down" size={12} data-collapsed={collapsedRepositories.includes(repo.id) ? 'true' : undefined} /><strong>{repo.name}</strong>
        <span>{repo.changes?.branch ?? $t('git.detachedHead')}</span><Badge variant="secondary">{repo.changes?.files.length ?? 0}</Badge>
      </Button>
      <small>{repo.relativePath !== repo.name && repo.relativePath !== '.' ? repo.relativePath : ''}{repo.kind === 'submodule' ? $t('git.submoduleSuffix') : repo.kind === 'worktree' ? $t('git.worktreeSuffix') : ''}{repo.externalRoot ? $t('git.externalRootSuffix') : ''}</small>
    </header>
    {#if !collapsedRepositories.includes(repo.id)}
      {#if repo.error}<p role="status">{repo.error}</p>
      {:else if !repo.changes}<p role="status">{$t('git.readingChanges')}</p>
      {:else if repo.changes.captureStatus !== 'captured'}<p role="status">{repo.changes.captureError}</p>
      {:else}
        {@render fileGroup('conflicted', $t('git.conflicted'), repo.changes.files.filter(file => file.conflicted), 'stage', repo.id)}
        {@render fileGroup('staged', $t('git.staged'), repo.changes.files.filter(file => file.staged && !file.conflicted), 'unstage', repo.id)}
        {@render fileGroup('changed', $t('git.changed'), repo.changes.files.filter(file => file.unstaged && !file.untracked && !file.conflicted), 'stage', repo.id)}
        {@render fileGroup('untracked', $t('git.untracked'), repo.changes.files.filter(file => file.untracked && !file.conflicted), 'stage', repo.id)}
        {#if repo.changes.files.some(file => file.unstaged || file.untracked)}<Button variant="ghost" size="sm" disabled={operationBusy || workspace?.trust !== 'trusted'} onclick={() => workspace && onApplyWorkspaceAction(workspace.id, 'stage_all', repo.id)}>{$t('git.stageAll')}</Button>{/if}
        {#if repo.changes.files.some(file => file.staged)}<Button variant="ghost" size="sm" disabled={operationBusy || workspace?.trust !== 'trusted'} onclick={() => workspace && onApplyWorkspaceAction(workspace.id, 'unstage_all', repo.id)}>{$t('git.unstageEverything')}</Button>{/if}
      {/if}
      <Button variant="outline" size="sm" disabled={operationBusy} onclick={() => onSelectRepository(repo.id)}>{repo.changes?.files.some(file => file.staged) ? $t('git.commitEllipsis') : $t('git.openRepository')}</Button>
    {/if}
  </section>
{/snippet}

<Card as="aside" class="inspector" data-ui-component="workspace-git-panel" aria-label={$t('git.title')}>
  {#if showTabs}<SidePanelTabs {activeView} gitCount={changeCount} onSelect={onSelectView} />{/if}
  <div id="side-panel-content-git" class="side-panel-view" role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? 'side-panel-tab-git' : undefined}>
  <div class="git-repository-toolbar">
    <RepositorySelect {repositories} selectedId={repositoryId} open={repositoryMenuOpen} search={repositorySearch} disabled={operationBusy || !workspace || repositories.length === 0}
      onOpenChange={(open) => { repositoryMenuOpen = open; if (!open) { pendingSection = undefined; onRepositorySearch(''); } }}
      onSearch={onRepositorySearch}
      onSelect={(id) => { onSelectRepository(id, id === null ? undefined : pendingSection); pendingSection = undefined; repositoryMenuOpen = false; onRepositorySearch(''); }}
    />
    <Button variant="outline" size="icon" aria-label={$t('git.refresh')} title={$t('git.refresh')} disabled={!workspace || loading} onclick={onRefresh}><Icon name="refresh" size={16} /></Button>
  </div>
  {#if currentRepository?.externalRoot}<small class="changeset-status">{$t('git.externalRoot')}</small>{/if}
  {#if discoveryLimited}<p role="status">{$t('git.discoveryLimited')}</p><Button variant="ghost" size="sm" disabled={loading} onclick={onContinueDiscovery}>{$t('git.continueDiscovery')}</Button>{/if}
  {#each discoveryWarnings as warning}<p role="status">{warning}</p>{/each}
  {#if workspace && desktop && repositoryId !== null && changes?.captureStatus === 'captured' && !error && !currentRepository?.error}
    <div class="git-branch-bar">
      <Button variant="ghost" size="sm" class="git-branch-trigger" aria-expanded={branchMenuOpen} title={headLabel ? `HEAD ${headLabel}` : $t('git.noCommits')} onclick={() => { branchMenuOpen = !branchMenuOpen; if (branchMenuOpen) onRefreshGitMetadata(workspace.id); }}>
        <Icon name="branch" size={16} /><span class="git-branch-label">{changes.branch ?? $t('git.detachedHead')}</span>
      </Button>
      <span class="git-upstream" title={remoteStatus?.upstream ?? $t('git.upstreamUnset')}>
        {[remoteStatus?.ahead ? `↑${remoteStatus.ahead}` : '', remoteStatus?.behind ? `↓${remoteStatus.behind}` : '', remoteStatus?.upstream ?? $t('git.noUpstream')].filter(Boolean).join(' ')}
      </span>
      {#if workspace.trust !== 'trusted'}<Badge variant="warning">{$t('git.readOnly')}</Badge>{/if}
      {#if remoteStatus?.upstream}
        <Button variant="outline" size="sm" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'pull')}>{$t('git.pull')}</Button>
        <Button variant="outline" size="sm" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'push')}>{$t('git.push')}</Button>
      {/if}
    </div>
      {#if branchMenuOpen}
        <section class="git-branch-menu" aria-label={$t('git.branches')}>
          {#if gitMetadataLoading && branches.length === 0}
            <div class="git-diff-message">{$t('git.loadingBranches')}</div>
          {:else if branches.length === 0}
            <div class="git-diff-message">{$t('git.emptyBranches')}</div>
          {:else}
            {#each branches as branch (branch.name)}
              <Button
                variant={branch.current ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                class="git-branch-item"
                disabled={branch.current || workspace.trust !== 'trusted' || operationBusy}
                onclick={() => {
                  onCheckoutBranch(workspace.id, branch.name);
                  branchMenuOpen = false;
                }}
              >
                <span>{branch.name}</span>
                {#if branch.current}<Icon name="check" size={11} />{/if}
              </Button>
            {/each}
          {/if}
          <form class="git-branch-create" onsubmit={(event) => { event.preventDefault(); submitBranch(); }}>
            <Input value={draftState.branchDraft} oninput={(event) => onDraftChange({ ...draftState, branchDraft: event.currentTarget.value })} aria-label={$t('git.newBranch')} placeholder={$t('git.newBranch')} disabled={workspace.trust !== 'trusted' || operationBusy} />
            <Button variant="ghost" size="sm" type="submit" disabled={!draftState.branchDraft.trim() || workspace.trust !== 'trusted' || operationBusy}>{$t('git.create')}</Button>
          </form>
        </section>
      {/if}

    {#if branchMenuOpen && remoteStatus?.upstream}<Button variant="ghost" size="sm" disabled={operationBusy} onclick={() => onSync(workspace.id, 'fetch')}>{$t('git.fetch')}</Button>{/if}
  {/if}
  <div class="git-section-toolbar">
    <div class="git-section-tabs" role="tablist" aria-label={$t('git.views')}>
      <Button
        id="git-changes-tab"
        aria-label={$t('git.changesTab')}
        variant="ghost"
        size="sm"
        type="button"
        role="tab"
        aria-controls="git-view-content"
        aria-selected={repositoryId === null || draftState.gitSection === 'changes'}
        tabindex={repositoryId === null || draftState.gitSection === 'changes' ? 0 : -1}
        onkeydown={moveGitTab}
        onclick={() => selectGitSection('changes')}
      >{$t('git.changesTab')} <Badge variant="secondary">{changeCount}</Badge></Button>
      <Button
        id="git-history-tab"
        variant="ghost"
        size="sm"
        type="button"
        role="tab"
        aria-controls="git-view-content"
        aria-selected={repositoryId !== null && draftState.gitSection === 'history'}
        tabindex={repositoryId !== null && draftState.gitSection === 'history' ? 0 : -1}
        onkeydown={moveGitTab}
        onclick={() => selectGitSection('history')}
      >{$t('git.historyTab')}</Button>
    </div>
    <Button
      variant="ghost"
      size="sm"
      type="button"
      class="git-review-button"
      disabled={!canRequestReview || reviewBusy || repositoryId === null}
      title={$t('git.reviewHint')}
      onclick={() => workspace && onRequestReview(workspace.id)}
    >
      <Icon name="review" size={12} data-icon="inline-start" aria-hidden="true" />
      {reviewBusy ? $t('git.reviewing') : $t('git.review')}
    </Button>
  </div>

  <div
    id="git-view-content"
    role="tabpanel"
    aria-labelledby={repositoryId === null || draftState.gitSection === 'changes' ? 'git-changes-tab' : 'git-history-tab'}
    aria-live="polite"
  >
    {#if !workspace}
      <div class="inspector-empty">{$t('git.selectWorkspace')}</div>
    {:else if !desktop}
      <div class="inspector-empty">{$t('git.desktopOnly')}</div>
    {:else if repositoryId === null}
      {#each repositories.filter(repo => !repo.changes || repo.error || repo.changes.captureStatus !== 'captured' || repo.changes.files.length > 0) as repo (repo.id)}{@render repositoryGroup(repo)}{/each}
      {@const clean = repositories.filter(repo => !repo.error && repo.changes?.captureStatus === 'captured' && repo.changes.files.length === 0)}
      {#if clean.length > 0}
        <Button variant="ghost" size="sm" aria-expanded={cleanRepositoriesOpen} onclick={() => cleanRepositoriesOpen = !cleanRepositoriesOpen}>{$t('git.cleanRepositories', {count: clean.length})}</Button>
        {#if cleanRepositoriesOpen}{#each clean as repo (repo.id)}{@render repositoryGroup(repo)}{/each}{/if}
      {/if}
      {#if loading}<p role="status">{$t('git.scanning')}</p>{:else if error}<p role="status">{error}</p>{:else if repositories.length === 0}<div class="inspector-empty">{$t('git.noRepositories')}</div>{/if}
    {:else if currentRepository?.error}<p role="status">{currentRepository.error}</p>
    {:else if loading && !changes}
      <div class="inspector-empty">{$t('git.loadingStatus')}</div>
    {:else if error}
      <div class="inspector-empty">{error}</div>
    {:else if changes?.captureStatus !== 'captured'}
      <div class="inspector-empty">{changes?.captureError ?? $t('git.statusUnavailable')}</div>
    {:else}
      {#if draftState.gitSection === 'changes'}
          <form class="git-commit-form" onsubmit={(event) => { event.preventDefault(); void submitCommit(); }}>
            <Input
              value={draftState.commitMessage} oninput={(event) => onDraftChange({ ...draftState, commitMessage: event.currentTarget.value })}
              aria-label={$t('git.commitMessage')}
              placeholder={$t('git.commitMessage')}
              disabled={workspace.trust !== 'trusted' || operationBusy}
            />
            <Button
              variant="outline"
              size="sm"
              type="submit"
              disabled={workspace.trust !== 'trusted' || operationBusy || stagedCount === 0 || !draftState.commitMessage.trim()}
            >
              {$t('git.commit')}
            </Button>
          </form>
      {/if}

      {#if draftState.gitSection === 'changes'}
        {@render fileGroup('conflicted', $t('git.conflicted'), conflictedFiles, 'stage')}
        {@render fileGroup('staged', $t('git.staged'), stagedFiles, 'unstage')}
        {@render fileGroup('changed', $t('git.changed'), changedFiles, 'stage')}
        {@render fileGroup('untracked', $t('git.untracked'), untrackedFiles, 'stage')}
        <section class="git-stash-section">
          <Button variant="ghost" size="sm" type="button" class="git-stash-trigger" onclick={() => (stashMenuOpen = !stashMenuOpen)}>
            <span>{$t('git.stash')}</span><Badge variant="secondary">{stashes.length}</Badge>
          </Button>
          {#if stashMenuOpen}
            <div class="git-stash-menu">
              {#if stashes.length === 0}<div class="git-diff-message">{$t('git.emptyStash')}</div>{/if}
              {#each stashes as stash (stash.reference)}
                <Button variant="ghost" size="sm" type="button" class="git-stash-item" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onApplyStash(workspace.id, stash.reference)}>
                  <span><strong>{stash.reference}</strong> {stash.message}</span><small>{$t('git.apply')}</small>
                </Button>
              {/each}
              <Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSaveStash(workspace.id)}>{$t('git.saveStash')}</Button>
            </div>
          {/if}
        </section>

        {#if changes.files.length === 0}
          <div class="inspector-empty">{$t('git.clean')}</div>
        {:else if workspace.trust !== 'trusted'}
          <div class="inspector-empty">{$t('git.trustRequired')}</div>
        {/if}
      {:else}
        {#if gitMetadataError}
          <div class="inspector-empty">{gitMetadataError}</div>
        {:else if gitMetadataLoading && history.length === 0}
          <div class="inspector-empty">{$t('git.loadingHistory')}</div>
        {:else if history.length === 0}
          <div class="inspector-empty">{$t('git.emptyHistory')}</div>
        {:else}
          <section class="git-history" aria-label={$t('git.history')}>
            {#each history as commit (commit.hash)}
              <div class="git-history-entry">
                <Button
                  variant={draftState.selectedCommit === commit.hash ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  class="git-history-item"
                  aria-expanded={draftState.selectedCommit === commit.hash}
                  aria-label={$t('git.commitFilesLabel', {hash: commit.shortHash, subject: commit.subject})}
                  title={commit.subject}
                  onclick={() => selectCommit(commit.hash)}
                >
                  <span class="git-history-copy">
                    <strong>{commit.subject}</strong>
                    <time class="git-history-time" datetime={commit.authoredAt} title={commit.authoredAt}>{commitTime(commit.authoredAt)}</time>
                    <small class="git-history-meta">
                      <code>{commit.shortHash}</code>
                      <span class="git-history-separator" aria-hidden="true">·</span>
                      <span class="git-history-author">{commit.author}</span>
                    </small>
                  </span>
                </Button>
                {#if draftState.selectedCommit === commit.hash}
                  <div class="git-commit-files" aria-label={$t('git.changedFilesLabel', {hash: commit.shortHash})}>
                    {#if commitFilesLoading && commitFiles?.commit !== commit.hash}
                      <div class="git-diff-message">{$t('git.loadingFiles')}</div>
                    {:else if commitFiles?.commit === commit.hash && commitFiles.total === 0}
                      <div class="git-diff-message">{$t('git.emptyCommitFiles')}</div>
                    {:else if commitFiles?.commit === commit.hash}
                      {#each commitFiles.files as file (file.path)}
                        {@const location = fileLocation(file)}
                        <Button variant="ghost" size="sm" type="button" class="git-commit-file" title={displayPath(file)} aria-label={$t('git.commitDiffLabel', {kind: changeLabel(file), path: displayPath(file)})} onclick={() => onOpenCommitFileDiff(workspace.id, commit.hash, file.path)}>
                          <FileChangeMark kind={file.kind} decorative />
                          <span class="changeset-file-copy">
                            <code class:changeset-file-name-only={!location} class="changeset-file-name">{fileName(file)}</code>
                            {#if location}<small class="changeset-file-location"><bdi dir="ltr">{location}</bdi></small>{/if}
                          </span>
                        </Button>
                      {/each}
                      {#if commitFiles.files.length < commitFiles.total}
                        <Button variant="ghost" size="sm" type="button" class="git-commit-files-more" disabled={commitFilesLoading} onclick={() => onLoadMoreCommitFiles(workspace.id, commit.hash)}>
                          {commitFilesLoading ? $t('git.loading') : $t('git.loadMoreFiles', {loaded: commitFiles.files.length, total: commitFiles.total})}
                        </Button>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
            {#if historyLoadMoreError}<div class="git-diff-message" role="alert">{historyLoadMoreError}</div>{/if}
            {#if historyHasMore && workspace}
              <Button variant="outline" size="sm" type="button" class="git-history-more" disabled={historyLoadingMore || gitMetadataLoading} onclick={() => onLoadMoreHistory(workspace.id)}>
                {historyLoadingMore ? $t('git.loadingMoreCommits') : historyLoadMoreError ? $t('git.retryMore') : $t('git.loadMoreCommits')}
              </Button>
            {/if}
          </section>
        {/if}
      {/if}
    {/if}
  </div>
  </div>
</Card>
