<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Input, Separator } from '$lib/ui-kit';
  import SidePanelTabs from './SidePanelTabs.svelte';
  import type {
    GitBranch,
    GitCommit,
    GitCommitDiff,
    GitRemoteStatus,
    GitStashEntry,
    GitSyncAction,
    GitWorkspaceAction,
    WorkspaceChanges,
    WorkspaceFileChange,
    WorkspaceFileDiff,
  } from '$lib/types';
  import type { WorkspaceListItem } from './view-types';

  type WorkspaceGitPanelProps = {
    workspace: WorkspaceListItem | null;
    desktop: boolean;
    changes: WorkspaceChanges | null;
    loading: boolean;
    error: string | null;
    fileDiff: WorkspaceFileDiff | null;
    fileDiffLoading: boolean;
    fileDiffError: string | null;
    branches: GitBranch[];
    history: GitCommit[];
    gitMetadataLoading: boolean;
    gitMetadataError: string | null;
    commitDiff: GitCommitDiff | null;
    commitDiffLoading: boolean;
    remoteStatus: GitRemoteStatus | null;
    stashes: GitStashEntry[];
    operationBusy: boolean;
    reviewBusy: boolean;
    canRequestReview: boolean;
    activeView: 'context' | 'git';
    onRefresh: () => void;
    onApplyFileAction: (workspaceId: string, path: string, action: 'stage' | 'unstage') => void;
    onApplyWorkspaceAction: (workspaceId: string, action: GitWorkspaceAction) => void;
    onCommit: (workspaceId: string, message: string) => void | Promise<boolean>;
    onOpenDiff: (workspaceId: string, path: string, staged: boolean) => void;
    onCloseDiff: () => void;
    onRefreshGitMetadata: (workspaceId: string) => void;
    onCheckoutBranch: (workspaceId: string, branch: string) => void;
    onCreateBranch: (workspaceId: string, branch: string) => void;
    onOpenCommitDiff: (workspaceId: string, commit: string) => void;
    onCloseCommitDiff: () => void;
    onSync: (workspaceId: string, action: GitSyncAction) => void;
    onSaveStash: (workspaceId: string) => void;
    onApplyStash: (workspaceId: string, reference: string) => void;
    onRequestReview: (workspaceId: string) => void;
    onSelectView: (view: 'context' | 'git') => void;
  };

  let {
    workspace,
    desktop,
    changes,
    loading,
    error,
    fileDiff,
    fileDiffLoading,
    fileDiffError,
    branches,
    history,
    gitMetadataLoading,
    gitMetadataError,
    commitDiff,
    commitDiffLoading,
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
    onCloseDiff,
    onRefreshGitMetadata,
    onCheckoutBranch,
    onCreateBranch,
    onOpenCommitDiff,
    onCloseCommitDiff,
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
  let commitMessage = $state('');
  let gitSection = $state<'changes' | 'history'>('changes');
  let branchMenuOpen = $state(false);
  let branchDraft = $state('');
  let stashMenuOpen = $state(false);

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

  async function submitCommit(): Promise<void> {
    if (!workspace || workspace.trust !== 'trusted' || operationBusy || !commitMessage.trim()) return;
    const committed = await onCommit(workspace.id, commitMessage.trim());
    if (committed) commitMessage = '';
  }

  function selectGitSection(section: 'changes' | 'history'): void {
    gitSection = section;
    branchMenuOpen = false;
    stashMenuOpen = false;
    if (section === 'history' && workspace) onRefreshGitMetadata(workspace.id);
  }

  function submitBranch(): void {
    if (!workspace || workspace.trust !== 'trusted' || !branchDraft.trim()) return;
    onCreateBranch(workspace.id, branchDraft.trim());
    branchDraft = '';
    branchMenuOpen = false;
  }
</script>

{#snippet fileGroup(title: string, files: WorkspaceFileChange[], action: 'stage' | 'unstage')}
  {#if files.length > 0}
    <Card class="changeset-card git-change-group">
      <CardHeader class="thread-card-heading">
        <CardTitle>{title}</CardTitle>
        <Badge variant="secondary">{files.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        <div class="thread-list" aria-label={title}>
          {#each files as file (`${title}:${file.path}`)}
            <div class="thread-item changeset-file changeset-file-row">
              <span class={`change-kind change-kind-${file.kind}`}>{changeMarker(file)}</span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="changeset-file-button"
                aria-label={`查看 ${file.path} 的差异`}
                title="查看文件差异"
                onclick={() => workspace && onOpenDiff(workspace.id, file.path, action === 'unstage')}
              >
                <span class="thread-copy"><code title={displayPath(file)}>{displayPath(file)}</code></span>
              </Button>
              <div class="changeset-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={action === 'stage' ? `暂存 ${file.path}` : `取消暂存 ${file.path}`}
                  title={action === 'stage' ? '暂存更改' : '取消暂存'}
                  disabled={!workspace || workspace.trust !== 'trusted' || operationBusy}
                  onclick={() => workspace && onApplyFileAction(workspace.id, file.path, action)}
                >
                  <Icon name={action === 'stage' ? 'add' : 'undo'} size={13} />
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </CardContent>
    </Card>
  {/if}
{/snippet}

<Card as="aside" class="inspector" data-ui-component="workspace-git-panel" aria-label="Git 源代码管理">
  <CardHeader class="panel-heading">
    <div>
      <CardTitle>源代码管理</CardTitle>
      {#if workspace}<small class="changeset-status">{workspace.label}</small>{/if}
    </div>
    <div class="project-action-heading-actions">
      {#if changes?.captureStatus === 'captured'}
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
  <SidePanelTabs {activeView} onSelect={onSelectView} />
  <Separator />
  <div class="git-section-tabs" role="tablist" aria-label="Git 视图">
    <Button
      variant={gitSection === 'changes' ? 'secondary' : 'ghost'}
      size="sm"
      type="button"
      role="tab"
      aria-selected={gitSection === 'changes'}
      onclick={() => selectGitSection('changes')}
    >变更</Button>
    <Button
      variant={gitSection === 'history' ? 'secondary' : 'ghost'}
      size="sm"
      type="button"
      role="tab"
      aria-selected={gitSection === 'history'}
      onclick={() => selectGitSection('history')}
    >历史</Button>
    <Button
      variant="ghost"
      size="sm"
      type="button"
      class="git-review-button"
      disabled={!canRequestReview || reviewBusy}
      title="创建独立只读会话审查 Git 变更"
      onclick={() => workspace && onRequestReview(workspace.id)}
    >{reviewBusy ? '审查中…' : 'Agent 审查'}</Button>
  </div>

  <div aria-live="polite">
    {#if !workspace}
      <div class="inspector-empty">选择一个工作区查看 Git 状态。</div>
    {:else if !desktop}
      <div class="inspector-empty">Git 视图仅在桌面模式中可用。</div>
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
            {#if changes.files.some((file) => file.unstaged || file.untracked)}
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
            {#if stagedCount > 0}
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
            <Input bind:value={branchDraft} aria-label="新分支名称" placeholder="新分支名称" disabled={workspace.trust !== 'trusted' || operationBusy} />
            <Button variant="ghost" size="sm" type="submit" disabled={!branchDraft.trim() || workspace.trust !== 'trusted' || operationBusy}>创建</Button>
          </form>
        </section>
      {/if}

      {#if remoteStatus?.upstream}
        <div class="git-remote-row" aria-label="Git 远端同步">
          <span>{remoteStatus.upstream}</span>
          {#if remoteStatus.ahead > 0}<Badge variant="secondary">↑{remoteStatus.ahead}</Badge>{/if}
          {#if remoteStatus.behind > 0}<Badge variant="warning">↓{remoteStatus.behind}</Badge>{/if}
          <Button variant="ghost" size="sm" type="button" disabled={operationBusy} onclick={() => onSync(workspace.id, 'fetch')}>刷新</Button>
          {#if remoteStatus.behind > 0}<Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'pull')}>拉取</Button>{/if}
          {#if remoteStatus.ahead > 0}<Button variant="ghost" size="sm" type="button" disabled={operationBusy || workspace.trust !== 'trusted'} onclick={() => onSync(workspace.id, 'push')}>推送</Button>{/if}
        </div>
      {/if}

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
        <form class="git-commit-form" onsubmit={(event) => { event.preventDefault(); void submitCommit(); }}>
          <Input
            bind:value={commitMessage}
            aria-label="提交信息"
            placeholder={`提交 ${stagedCount} 项更改…`}
            disabled={workspace.trust !== 'trusted' || operationBusy}
          />
          <Button
            variant="default"
            size="sm"
            type="submit"
            disabled={workspace.trust !== 'trusted' || operationBusy || !commitMessage.trim()}
          >
            提交
          </Button>
        </form>
      {/if}

      {#if gitSection === 'changes' && (fileDiff || fileDiffLoading || fileDiffError)}
        <section class="git-diff-view" aria-label="文件差异">
          <header class="git-diff-header">
            <div class="git-diff-title">
              <Button variant="ghost" size="icon" type="button" aria-label="关闭文件差异" title="关闭" onclick={onCloseDiff}>
                <Icon name="close" size={13} />
              </Button>
              <div>
                <strong>{fileDiff?.path ?? '正在读取文件差异…'}</strong>
                {#if fileDiff}<small>{fileDiff.staged ? '暂存区' : '工作区'}</small>{/if}
              </div>
            </div>
          </header>
          {#if fileDiffLoading}
            <div class="git-diff-message">正在读取差异…</div>
          {:else if fileDiffError}
            <div class="git-diff-message" role="alert">{fileDiffError}</div>
          {:else if fileDiff?.available}
            <pre>{fileDiff.diff}</pre>
          {:else}
            <div class="git-diff-message">{fileDiff?.reason ?? '当前文件没有可展示的差异。'}</div>
          {/if}
        </section>
      {/if}

      {#if gitSection === 'changes'}
        {@render fileGroup('合并冲突', conflictedFiles, 'stage')}
        {@render fileGroup('已暂存的更改', stagedFiles, 'unstage')}
        {@render fileGroup('更改', changedFiles, 'stage')}
        {@render fileGroup('未跟踪的文件', untrackedFiles, 'stage')}

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
              <Button variant="ghost" size="sm" type="button" class="git-history-item" onclick={() => onOpenCommitDiff(workspace.id, commit.hash)}>
                <span class="git-history-copy">
                  <strong>{commit.subject}</strong>
                  <small>{commit.shortHash} · {commit.author}</small>
                </span>
              </Button>
            {/each}
          </section>
        {/if}
        {#if commitDiff || commitDiffLoading}
          <section class="git-diff-view" aria-label="提交差异">
            <header class="git-diff-header">
              <div class="git-diff-title">
                <Button variant="ghost" size="icon" type="button" aria-label="关闭提交差异" title="关闭" onclick={onCloseCommitDiff}>
                  <Icon name="close" size={13} />
                </Button>
                <div><strong>{commitDiff?.commit.slice(0, 8) ?? '正在读取提交差异…'}</strong><small>提交差异</small></div>
              </div>
            </header>
            {#if commitDiffLoading}<div class="git-diff-message">正在读取差异…</div>
            {:else if commitDiff?.available}<pre>{commitDiff.diff}</pre>
            {:else}<div class="git-diff-message">{commitDiff?.reason ?? '该提交没有可展示的差异。'}</div>{/if}
          </section>
        {/if}
      {/if}
    {/if}
  </div>
</Card>
