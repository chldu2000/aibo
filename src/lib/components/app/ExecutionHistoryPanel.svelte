<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '$lib/ui-kit';
  import { canStopExecution, executionActive, executionStatus, type ExecutionHistoryState } from '$lib/app/execution-history-controller';
  let { workspaces, workspaceId, windowId, state, desktop, onSelectWorkspace, onRefresh, onStop, onClose }: {
    workspaces: { id: string; label: string }[]; workspaceId: string | null; windowId: string;
    state: ExecutionHistoryState; desktop: boolean; onSelectWorkspace: (id: string) => void;
    onRefresh: () => void; onStop: (key: string) => void; onClose: () => void;
  } = $props();
  let heading: HTMLHeadingElement;
  onMount(() => heading?.focus());
</script>

<section aria-labelledby="execution-history-heading" data-ui-component="execution-history" class="execution-history">
  <div class="history-heading">
    <h2 id="execution-history-heading" tabindex="-1" bind:this={heading}>执行历史</h2>
    <Button variant="outline" onclick={onRefresh} disabled={!desktop || !workspaceId || state.loading}>刷新记录</Button>
    <Button variant="ghost" onclick={onClose}>返回工作台</Button>
  </div>
  <nav aria-label="执行历史工作区" class="history-workspaces">
    {#each workspaces as workspace (workspace.id)}
      <Button variant={workspace.id === workspaceId ? 'secondary' : 'ghost'} aria-pressed={workspace.id === workspaceId} onclick={() => onSelectWorkspace(workspace.id)}>{workspace.label}</Button>
    {/each}
  </nav>
  <p>显示所选工作区最近 20 条工程任务与 20 条 Git 写入。关闭此页不会停止执行。</p>
  {#if !desktop}<p role="status">执行历史需要桌面宿主。</p>
  {:else if !workspaceId}<p role="status">请先添加工作区。</p>
  {:else if state.loading}<p role="status">正在读取执行记录…</p>
  {/if}
  {#each state.errors as error}<p role="alert">{error}</p>{/each}
  {#if desktop && workspaceId && !state.loading && !state.entries.length && !state.errors.length}<p role="status">暂无执行记录。</p>{/if}
  <div class="history-entries">
    {#each state.entries as entry (entry.key)}
      <Card as="article" aria-label={`${entry.kind === 'git' ? 'Git' : '工程任务'} · ${entry.title}`}>
        <CardHeader>
          <CardTitle>{entry.kind === 'git' ? 'Git' : '工程任务'} · {entry.title}</CardTitle>
          <Badge variant={entry.status === 'outcome_unknown' || entry.status === 'failed' ? 'warning' : 'outline'}>{executionStatus(entry)}</Badge>
        </CardHeader>
        <CardContent>
          <p>开始：<time datetime={entry.startedAt}>{new Date(entry.startedAt).toLocaleString()}</time>{#if entry.completedAt} · 结束：<time datetime={entry.completedAt}>{new Date(entry.completedAt).toLocaleString()}</time>{/if}</p>
          {#if entry.caller}<p>发起窗口：{entry.caller}</p>{/if}
          {#if entry.input}<Textarea aria-label={`${entry.title}操作输入`} value={entry.input} readonly rows={3} />{/if}
          {#if entry.output}<Textarea aria-label={`${entry.title}执行结果`} value={entry.output} readonly rows={6} />{/if}
          {#if canStopExecution(entry, windowId)}
            <Button variant="outline" disabled={!desktop || state.stopping.includes(entry.key)} onclick={() => onStop(entry.key)} aria-label={`停止 ${entry.title}`}>{state.stopping.includes(entry.key) ? '正在请求停止…' : '停止'}</Button>
          {:else if executionActive(entry) && entry.kind === 'git' && entry.caller !== windowId}
            <p>请在发起窗口停止此 Git 操作。</p>
          {/if}
        </CardContent>
      </Card>
    {/each}
  </div>
</section>

<style>
  .execution-history { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-height: 0; overflow: auto; }
  .history-heading, .history-workspaces { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .history-heading h2 { flex: 1; }
  .history-entries { display: grid; gap: 12px; }
</style>
