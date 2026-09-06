<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { WorkspaceChanges, WorkspaceFileChange } from '$lib/types';
  import type { WorkspaceListItem } from './view-types';

  type WorkspaceGitPanelProps = {
    workspace: WorkspaceListItem | null;
    desktop: boolean;
    changes: WorkspaceChanges | null;
    loading: boolean;
    error: string | null;
    busyPath: string | null;
    onRefresh: () => void;
    onApplyFileAction: (workspaceId: string, path: string, action: 'stage' | 'unstage') => void;
  };

  let {
    workspace,
    desktop,
    changes,
    loading,
    error,
    busyPath,
    onRefresh,
    onApplyFileAction,
  }: WorkspaceGitPanelProps = $props();

  const conflictedFiles = $derived(changes?.files.filter((file) => file.conflicted) ?? []);
  const stagedFiles = $derived(changes?.files.filter((file) => file.staged && !file.conflicted) ?? []);
  const changedFiles = $derived(changes?.files.filter((file) => file.unstaged && !file.untracked && !file.conflicted) ?? []);
  const untrackedFiles = $derived(changes?.files.filter((file) => file.untracked && !file.conflicted) ?? []);
  const headLabel = $derived(changes?.head ? changes.head.slice(0, 8) : null);

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
              <div class="thread-copy">
                <code title={displayPath(file)}>{displayPath(file)}</code>
              </div>
              <div class="changeset-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={action === 'stage' ? `暂存 ${file.path}` : `取消暂存 ${file.path}`}
                  title={action === 'stage' ? '暂存更改' : '取消暂存'}
                  disabled={!workspace || workspace.trust !== 'trusted' || busyPath !== null}
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
  <Separator />

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
          <div>
            <CardTitle>{changes.branch ?? 'Detached HEAD'}</CardTitle>
            <small class="changeset-status">{headLabel ? `HEAD ${headLabel}` : '尚无提交'}</small>
          </div>
          <Badge variant={workspace.trust === 'trusted' ? 'outline' : 'warning'}>
            {workspace.trust === 'trusted' ? '可操作' : '只读'}
          </Badge>
        </CardHeader>
      </Card>

      {@render fileGroup('合并冲突', conflictedFiles, 'stage')}
      {@render fileGroup('已暂存的更改', stagedFiles, 'unstage')}
      {@render fileGroup('更改', changedFiles, 'stage')}
      {@render fileGroup('未跟踪的文件', untrackedFiles, 'stage')}

      {#if changes.files.length === 0}
        <div class="inspector-empty">工作区干净，没有待处理的更改。</div>
      {:else if workspace.trust !== 'trusted'}
        <div class="inspector-empty">信任工作区后可暂存或取消暂存文件。</div>
      {/if}
    {/if}
  </div>
</Card>
