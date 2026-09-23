<script lang="ts">
  import type { GitRepositoryState } from '../../../../packages/plugin-protocol/src/presentation-git';
  import type { GitPanelState } from '$lib/app/workbench-drafts';
  import { Badge, Button, Card, CardHeader, CardTitle, Icon, Input, RepositorySelect, Separator } from '$lib/ui-kit';
  import SidePanelTabs from './SidePanelTabs.svelte';
  import type {
    GitBranch,
    GitCommit,
    GitCommitFile,
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
    onRefresh: () => void;
    onApplyFileAction: (workspaceId: string, path: string, action: 'stage' | 'unstage', repositoryId?: string) => void;
    onApplyWorkspaceAction: (workspaceId: string, action: GitWorkspaceAction, repositoryId?: string) => void;
    onCommit: (workspaceId: string, message: string) => void | Promise<boolean>;
    onOpenDiff: (workspaceId: string, path: string, staged: boolean, repositoryId?: string) => void;
    onRefreshGitMetadata: (workspaceId: string) => void;
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
    gitMetadataLoading,
    gitMetadataError,
    commitFiles,
    commitFilesLoading,
    remoteStatus,
    stashes,
    operationBusy,
    reviewBusy,
    canRequestReview,
    activeView,
    onRefresh,
    onApplyFileAction,
    onApplyWorkspaceAction,
    onCommit,
    onOpenDiff,
    onRefreshGitMetadata,
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

  function displayPath(file: WorkspaceFileChange): string {
    return file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  }

  function changeMarker(file: WorkspaceFileChange): string {
    if (file.conflicted) return '!';
    if (file.kind === 'added') return 'A';
    if (file.kind === 'deleted') return 'D';
    if (file.kind === 'renamed') return 'R';
    return 'M';
  }

  function changeLabel(file: WorkspaceFileChange): string {
    if (file.conflicted) return '合并冲突';
    if (file.kind === 'added') return '新增';
    if (file.kind === 'deleted') return '删除';
    if (file.kind === 'renamed') return '重命名';
    return '修改';
  }

  function pathName(path: string): string {
    return path.split('/').at(-1) ?? path;
  }

  function pathParent(path: string): string {
    const segments = path.split('/');
    segments.pop();
    return segments.join('/');
  }

  function fileName(file: WorkspaceFileChange): string {
    return file.previousPath
      ? `${pathName(file.previousPath)} → ${pathName(file.path)}`
      : pathName(file.path);
  }

  function fileLocation(file: WorkspaceFileChange): string {
    const currentParent = pathParent(file.path);
    if (!file.previousPath) return currentParent;
    const previousParent = pathParent(file.previousPath);
    return previousParent !== currentParent
      ? `${previousParent || '.'} → ${currentParent || '.'}`
      : currentParent;
  }

  function commitFileMarker(file: GitCommitFile): string {
    if (file.kind === 'added') return 'A';
    if (file.kind === 'deleted') return 'D';
    if (file.kind === 'renamed') return 'R';
    return 'M';
  }

  function selectCommit(commit: string): void {
    onDraftChange({ ...draftState, selectedCommit: commit });
    onSelectCommit(workspace!.id, commit);
  }

  function commitTime(value: string): string {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  }

  async function submitCommit(): Promise<void> {
    if (!workspace || workspace.trust !== 'trusted' || operationBusy || !draftState.commitMessage.trim()) return;
    await onCommit(workspace.id, draftState.commitMessage.trim());
  }

  function selectGitSection(section: 'changes' | 'history'): void {
    if (repositoryId === null && section === 'history') { pendingSection = 'history'; repositoryMenuOpen = true; return; }
    onDraftChange({ ...draftState, gitSection: section });
    branchMenuOpen = false;
    stashMenuOpen = false;
    if (section === 'history' && workspace) onRefreshGitMetadata(workspace.id);
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
          <Badge variant="secondary">{files.length}</Badge>
        </Button>
      </header>
      {#if (expandedChangeGroups[`${repoId ?? repositoryId}:${group}`] ?? true)}
      <div id={`git-change-list-${repoId ?? repositoryId}-${group}`} class="git-change-list" role="list">
          {#each files as file (`${title}:${file.path}`)}
            {@const location = fileLocation(file)}
            <div
              class="changeset-file changeset-file-row"
              class:changeset-file-selected={((repoId ?? repositoryId) === previewRepositoryId) && selectedFilePath === file.path && selectedFileStaged === (action === 'unstage')}
              role="listitem"
              aria-current={((repoId ?? repositoryId) === previewRepositoryId) && selectedFilePath === file.path && selectedFileStaged === (action === 'unstage') ? 'true' : undefined}
            >
              <span
                class={`change-kind change-kind-${file.conflicted ? 'conflicted' : file.kind}`}
                aria-hidden="true"
                title={changeLabel(file)}
              >{changeMarker(file)}</span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="changeset-file-button"
                aria-label={`查看${changeLabel(file)}文件 ${file.path} 的差异`}
                title="查看文件差异"
                onclick={() => workspace && onOpenDiff(workspace.id, file.path, action === 'unstage', repoId)}
              >
                <span class="changeset-file-copy" title={displayPath(file)}>
                  <code class:changeset-file-name-only={!location} class="changeset-file-name">{fileName(file)}</code>
                  {#if location}<small class="changeset-file-location">{location}</small>{/if}
                </span>
              </Button>
              <div class="changeset-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={action === 'stage' ? `暂存 ${file.path}` : `取消暂存 ${file.path}`}
                  title={action === 'stage' ? '暂存更改' : '取消暂存'}
                  disabled={!workspace || workspace.trust !== 'trusted' || operationBusy}
                  onclick={() => workspace && onApplyFileAction(workspace.id, file.path, action, repoId)}
                >
                  <Icon name={action === 'stage' ? 'add' : 'undo'} size={13} />
                </Button>
              </div>
            </div>
          {/each}
      </div>
      {/if}
    </section>
  {/if}
{/snippet}

{#snippet repositoryGroup(repo: GitRepositoryState)}
  <section class="git-change-group" aria-label={`仓库 ${repo.name} ${repo.relativePath}`}>
    <header class="git-change-group-heading">
      <Button variant="ghost" size="sm" aria-expanded={!collapsedRepositories.includes(repo.id)} onclick={() => onToggleRepository(repo.id)}>
        <Icon name="chevron-down" size={12} data-collapsed={collapsedRepositories.includes(repo.id) ? 'true' : undefined} /><strong>{repo.name}</strong>
        <span>{repo.changes?.branch ?? 'Detached HEAD'}</span><Badge variant="secondary">{repo.changes?.files.length ?? 0}</Badge>
      </Button>
      <small>{repo.relativePath}{repo.kind === 'submodule' ? ' · 子模块' : repo.kind === 'worktree' ? ' · Worktree' : ''}{repo.externalRoot ? ' · 仓库根目录位于工作区外' : ''}</small>
    </header>
    {#if !collapsedRepositories.includes(repo.id)}
      {#if repo.error}<p role="status">{repo.error}</p>
      {:else if !repo.changes}<p role="status">正在读取变更…</p>
      {:else if repo.changes.captureStatus !== 'captured'}<p role="status">{repo.changes.captureError}</p>
      {:else}
        {@render fileGroup('conflicted', '合并冲突', repo.changes.files.filter(file => file.conflicted), 'stage', repo.id)}
        {@render fileGroup('staged', '已暂存的更改', repo.changes.files.filter(file => file.staged && !file.conflicted), 'unstage', repo.id)}
        {@render fileGroup('changed', '更改', repo.changes.files.filter(file => file.unstaged && !file.untracked && !file.conflicted), 'stage', repo.id)}
        {@render fileGroup('untracked', '未跟踪的文件', repo.changes.files.filter(file => file.untracked && !file.conflicted), 'stage', repo.id)}
        {#if repo.changes.files.some(file => file.unstaged || file.untracked)}<Button variant="ghost" size="sm" disabled={operationBusy || workspace?.trust !== 'trusted'} onclick={() => workspace && onApplyWorkspaceAction(workspace.id, 'stage_all', repo.id)}>全部暂存</Button>{/if}
        {#if repo.changes.files.some(file => file.staged)}<Button variant="ghost" size="sm" disabled={operationBusy || workspace?.trust !== 'trusted'} onclick={() => workspace && onApplyWorkspaceAction(workspace.id, 'unstage_all', repo.id)}>全部取消暂存</Button>{/if}
      {/if}
      <Button variant="outline" size="sm" disabled={operationBusy} onclick={() => onSelectRepository(repo.id)}>{repo.changes?.files.some(file => file.staged) ? '提交…' : '打开仓库'}</Button>
    {/if}
  </section>
{/snippet}

<Card as="aside" class="inspector" data-ui-component="workspace-git-panel" aria-label="Git 源代码管理">
  <SidePanelTabs {activeView} onSelect={onSelectView} />
  <div id="side-panel-content-git" class="side-panel-view" role="tabpanel" aria-labelledby="side-panel-tab-git">
  <CardHeader class="panel-heading">
    <div>
      <CardTitle>源代码管理</CardTitle>
      {#if workspace}<small class="changeset-status">{workspace.label}</small>{/if}
    </div>
    <div class="project-action-heading-actions">
      {#if repositoryId === null && repositories.length > 0}
        <Badge variant="secondary">{repositories.reduce((sum, repo) => sum + (repo.changes?.files.length ?? 0), 0)}</Badge>
      {:else if changes?.captureStatus === 'captured'}
        <Badge variant={changes.dirty ? 'warning' : 'secondary'}>{changes.files.length}</Badge>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="刷新 Git 状态"
        title="刷新 Git 状态"
        disabled={!workspace || loading}
        onclick={onRefresh}
      >
        <Icon name="refresh" size={13} />
      </Button>
    </div>
  </CardHeader>
  <Separator />
  {#if repositories.length > 1 || repositoryId === null}
    <RepositorySelect {repositories} selectedId={repositoryId} open={repositoryMenuOpen} search={repositorySearch} disabled={operationBusy}
      onOpenChange={(open) => { repositoryMenuOpen = open; if (!open) { pendingSection = undefined; onRepositorySearch(''); } }}
      onSearch={onRepositorySearch}
      onSelect={(id) => { onSelectRepository(id, id === null ? undefined : pendingSection); pendingSection = undefined; repositoryMenuOpen = false; onRepositorySearch(''); }}
    />
  {/if}
  {#if currentRepository?.externalRoot}<small class="changeset-status">仓库根目录位于工作区外</small>{/if}
  {#if discoveryLimited}<p role="status">发现范围受限</p><Button variant="ghost" size="sm" disabled={loading} onclick={onContinueDiscovery}>继续扫描</Button>{/if}
  {#each discoveryWarnings as warning}<p role="status">{warning}</p>{/each}
  <div class="git-section-toolbar">
    <div class="git-section-tabs" role="tablist" aria-label="Git 视图">
      <Button
        id="git-changes-tab"
        variant="ghost"
        size="sm"
        type="button"
        role="tab"
        aria-controls="git-view-content"
        aria-selected={repositoryId === null || draftState.gitSection === 'changes'}
        tabindex={repositoryId === null || draftState.gitSection === 'changes' ? 0 : -1}
        onkeydown={moveGitTab}
        onclick={() => selectGitSection('changes')}
      >变更</Button>
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
      >历史</Button>
    </div>
    <Button
      variant="outline"
      size="sm"
      type="button"
      class="git-review-button"
      disabled={!canRequestReview || reviewBusy || repositoryId === null}
      title="创建独立只读会话审查 Git 变更"
      onclick={() => workspace && onRequestReview(workspace.id)}
    >
      <Icon name="review" size={12} data-icon="inline-start" aria-hidden="true" />
      {reviewBusy ? '审查中…' : 'Agent 审查'}
    </Button>
  </div>

  <div
    id="git-view-content"
    role="tabpanel"
    aria-labelledby={repositoryId === null || draftState.gitSection === 'changes' ? 'git-changes-tab' : 'git-history-tab'}
    aria-live="polite"
  >
    {#if !workspace}
      <div class="inspector-empty">选择一个工作区查看 Git 状态。</div>
    {:else if !desktop}
      <div class="inspector-empty">Git 视图仅在桌面模式中可用。</div>
    {:else if repositoryId === null}
      {#each repositories.filter(repo => !repo.changes || repo.error || repo.changes.captureStatus !== 'captured' || repo.changes.files.length > 0) as repo (repo.id)}{@render repositoryGroup(repo)}{/each}
      {@const clean = repositories.filter(repo => !repo.error && repo.changes?.captureStatus === 'captured' && repo.changes.files.length === 0)}
      {#if clean.length > 0}
        <Button variant="ghost" size="sm" aria-expanded={cleanRepositoriesOpen} onclick={() => cleanRepositoriesOpen = !cleanRepositoriesOpen}>干净的仓库（{clean.length}）</Button>
        {#if cleanRepositoriesOpen}{#each clean as repo (repo.id)}{@render repositoryGroup(repo)}{/each}{/if}
      {/if}
      {#if loading}<p role="status">正在扫描仓库…</p>{:else if error}<p role="status">{error}</p>{:else if repositories.length === 0}<div class="inspector-empty">工作区内未发现 Git 仓库。</div>{/if}
    {:else if currentRepository?.error}<p role="status">{currentRepository.error}</p>
    {:else if loading && !changes}
      <div class="inspector-empty">正在读取 Git 状态…</div>
    {:else if error}
      <div class="inspector-empty">{error}</div>
    {:else if changes?.captureStatus !== 'captured'}
      <div class="inspector-empty">{changes?.captureError ?? '当前工作区无法读取 Git 状态。'}</div>
    {:else}
      <Card class="changeset-card git-summary-card">
        <CardHeader class="thread-card-heading">
          <div class="git-branch-summary">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="git-branch-trigger"
              aria-expanded={branchMenuOpen}
              onclick={() => {
                branchMenuOpen = !branchMenuOpen;
                if (branchMenuOpen) onRefreshGitMetadata(workspace.id);
              }}
            >
              <Icon name="branch" size={12} />
              <span class="git-branch-label">{changes.branch ?? 'Detached HEAD'}</span>
              <Icon name="chevron-down" size={11} />
            </Button>
            <small class="changeset-status">{headLabel ? `HEAD ${headLabel}` : '尚无提交'}</small>
          </div>
          <div class="git-summary-actions">
            <Badge variant={workspace.trust === 'trusted' ? 'outline' : 'warning'}>
              {workspace.trust === 'trusted' ? '可操作' : '只读'}
            </Badge>
            {#if draftState.gitSection === 'changes' && changes.files.some((file) => file.unstaged || file.untracked)}
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="暂存全部更改"
                title="暂存全部更改"
                disabled={workspace.trust !== 'trusted' || operationBusy}
                onclick={() => onApplyWorkspaceAction(workspace.id, 'stage_all')}
              >
                <Icon name="add" size={13} />
              </Button>
            {/if}
            {#if draftState.gitSection === 'changes' && stagedCount > 0}
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="取消全部暂存"
                title="取消全部暂存"
                disabled={workspace.trust !== 'trusted' || operationBusy}
                onclick={() => onApplyWorkspaceAction(workspace.id, 'unstage_all')}
              >
                <Icon name="undo" size={13} />
              </Button>
            {/if}
          </div>
        </CardHeader>
      </Card>

      {#if branchMenuOpen}
        <section class="git-branch-menu" aria-label="Git 分支">
          {#if gitMetadataLoading && branches.length === 0}
            <div class="git-diff-message">正在读取分支…</div>
          {:else if branches.length === 0}
            <div class="git-diff-message">当前仓库还没有本地分支。</div>
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
            <Input value={draftState.branchDraft} oninput={(event) => onDraftChange({ ...draftState, branchDraft: event.currentTarget.value })} aria-label="新分支名称" placeholder="新分支名称" disabled={workspace.trust !== 'trusted' || operationBusy} />
            <Button variant="ghost" size="sm" type="submit" disabled={!draftState.branchDraft.trim() || workspace.trust !== 'trusted' || operationBusy}>创建</Button>
          </form>
        </section>
      {/if}

      {#if remoteStatus?.upstream}
        <div class="git-remote-row" aria-label="Git 远端同步">
          <span>{currentRepository?.name} · {remoteStatus.upstream}</span>
          {#if remoteStatus.ahead > 0}<Badge variant="secondary">↑{remoteStatus.ahead}</Badge>{/if}
          {#if remoteStatus.behind > 0}<Badge variant="warning">↓{remoteStatus.behind}</Badge>{/if}
          <Button variant="ghost" size="sm" type="button" disabled={operationBusy} onclick={() => onSync(workspace.id, 'fetch')}>刷新</Button>
          {#if remoteStatus.behind > 0}<Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'pull')}>拉取</Button>{/if}
          {#if remoteStatus.ahead > 0}<Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'push')}>推送</Button>{/if}
        </div>
      {/if}

      {#if draftState.gitSection === 'changes'}
        <section class="git-stash-section">
          <Button variant="ghost" size="sm" type="button" class="git-stash-trigger" onclick={() => (stashMenuOpen = !stashMenuOpen)}>
            <span>暂存栈</span><Badge variant="secondary">{stashes.length}</Badge>
          </Button>
          {#if stashMenuOpen}
            <div class="git-stash-menu">
              {#if stashes.length === 0}<div class="git-diff-message">没有暂存栈。</div>{/if}
              {#each stashes as stash (stash.reference)}
                <Button variant="ghost" size="sm" type="button" class="git-stash-item" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onApplyStash(workspace.id, stash.reference)}>
                  <span><strong>{stash.reference}</strong> {stash.message}</span><small>应用</small>
                </Button>
              {/each}
              <Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSaveStash(workspace.id)}>保存当前更改</Button>
            </div>
          {/if}
        </section>

        {#if stagedCount > 0}
          <p>提交到 {currentRepository?.name} · {changes.branch ?? 'Detached HEAD'}</p>
          <form class="git-commit-form" onsubmit={(event) => { event.preventDefault(); void submitCommit(); }}>
            <Input
              value={draftState.commitMessage} oninput={(event) => onDraftChange({ ...draftState, commitMessage: event.currentTarget.value })}
              aria-label="提交信息"
              placeholder={`提交 ${stagedCount} 项更改…`}
              disabled={workspace.trust !== 'trusted' || operationBusy}
            />
            <Button
              variant="default"
              size="sm"
              type="submit"
              disabled={workspace.trust !== 'trusted' || operationBusy || !draftState.commitMessage.trim()}
            >
              提交
            </Button>
          </form>
        {/if}
      {/if}

      {#if draftState.gitSection === 'changes'}
        {@render fileGroup('conflicted', '合并冲突', conflictedFiles, 'stage')}
        {@render fileGroup('staged', '已暂存的更改', stagedFiles, 'unstage')}
        {@render fileGroup('changed', '更改', changedFiles, 'stage')}
        {@render fileGroup('untracked', '未跟踪的文件', untrackedFiles, 'stage')}

        {#if changes.files.length === 0}
          <div class="inspector-empty">工作区干净，没有待处理的更改。</div>
        {:else if workspace.trust !== 'trusted'}
          <div class="inspector-empty">信任工作区后可暂存或取消暂存文件。</div>
        {/if}
      {:else}
        {#if gitMetadataError}
          <div class="inspector-empty">{gitMetadataError}</div>
        {:else if gitMetadataLoading && history.length === 0}
          <div class="inspector-empty">正在读取提交历史…</div>
        {:else if history.length === 0}
          <div class="inspector-empty">当前仓库还没有提交历史。</div>
        {:else}
          <section class="git-history" aria-label="提交历史">
            {#each history as commit (commit.hash)}
              <div class="git-history-entry">
                <Button
                  variant={draftState.selectedCommit === commit.hash ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  class="git-history-item"
                  aria-expanded={draftState.selectedCommit === commit.hash}
                  aria-label={`查看提交 ${commit.shortHash} 的文件：${commit.subject}`}
                  title={commit.subject}
                  onclick={() => selectCommit(commit.hash)}
                >
                  <span class="git-history-copy">
                    <strong>{commit.subject}</strong>
                    <small class="git-history-meta">
                      <code>{commit.shortHash}</code>
                      <span>{commit.author}</span>
                      <time datetime={commit.authoredAt}>{commitTime(commit.authoredAt)}</time>
                    </small>
                  </span>
                </Button>
                {#if draftState.selectedCommit === commit.hash}
                  <div class="git-commit-files" aria-label={`提交 ${commit.shortHash} 更改的文件`}>
                    {#if commitFilesLoading && commitFiles?.commit !== commit.hash}
                      <div class="git-diff-message">正在读取文件列表…</div>
                    {:else if commitFiles?.commit === commit.hash && commitFiles.total === 0}
                      <div class="git-diff-message">该提交没有更改文件。</div>
                    {:else if commitFiles?.commit === commit.hash}
                      {#each commitFiles.files as file (file.path)}
                        <Button variant="ghost" size="sm" type="button" class="git-commit-file" title={file.path} onclick={() => onOpenCommitFileDiff(workspace.id, commit.hash, file.path)}>
                          <span class={`change-kind change-kind-${file.kind}`} aria-hidden="true">{commitFileMarker(file)}</span>
                          <span>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
                        </Button>
                      {/each}
                      {#if commitFiles.files.length < commitFiles.total}
                        <Button variant="ghost" size="sm" type="button" class="git-commit-files-more" disabled={commitFilesLoading} onclick={() => onLoadMoreCommitFiles(workspace.id, commit.hash)}>
                          {commitFilesLoading ? '正在加载…' : `加载更多（${commitFiles.files.length}/${commitFiles.total}）`}
                        </Button>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    {/if}
  </div>
  </div>
</Card>
