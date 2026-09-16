<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SubagentDialog, Badge, Button } from '$lib/ui-kit';
  import MarkdownContent from './MarkdownContent.svelte';
  import { subagentStatusLabels, type SubagentTask, type SubagentEntry } from '$lib/app/subagents';
  let {open, agent, entries, loading, error, onClose, onRetry}: {
    open: boolean; agent: SubagentTask; entries: SubagentEntry[]; loading: boolean; error: string | null;
    onClose: () => void; onRetry: () => void;
  } = $props();
  const agentId = $derived(agent.id);
  let feed: HTMLDivElement;
  let pinned = true;
  let unread = $state(false);
  const positions = new Map<string, {top:number; pinned:boolean}>();
  function savePosition() {
    if (!feed || !open) return;
    pinned = feed.scrollHeight - feed.clientHeight - feed.scrollTop < 40;
    positions.set(agent.id,{top:feed.scrollTop,pinned});
    if (pinned) unread = false;
  }
  $effect(() => {
    const visible = open; const id = agentId;
    if (visible) void tick().then(() => { untrack(() => {
      const saved = positions.get(id); pinned = saved?.pinned ?? true;
      if (feed) feed.scrollTop = pinned ? feed.scrollHeight : saved?.top ?? 0;
      unread = false;
    }); });
  });
  $effect(() => {
    const current = entries;
    if (open && current.length) void tick().then(() => { if (!feed) return; if (pinned) feed.scrollTop = feed.scrollHeight; else unread = true; });
  });
  function latest() { pinned = true; unread = false; if(feed) feed.scrollTop = feed.scrollHeight; }
</script>
<SubagentDialog {open} title={agent.name} task={agent.task} statusLabel={subagentStatusLabels[agent.status]} {onClose}>
  {#if loading}<p class="subagent-feedback" role="status">正在读取过程记录…</p>{/if}
  {#if error}<div class="subagent-feedback" role="alert">{error}<Button variant="outline" size="sm" onclick={onRetry}>重试</Button></div>{/if}
  <div class="subagent-feed" bind:this={feed} onscroll={savePosition}>
    {#each entries as entry (entry.id)}
      <article class="subagent-entry">
        <div class="entry-meta"><Badge variant="outline">{entry.role === 'assistant' ? agent.name : entry.role === 'tool' ? '工具' : entry.role === 'system' ? '思考摘要' : '任务'}</Badge><Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>{entry.status === 'streaming' ? '进行中' : entry.status === 'failed' ? '失败' : entry.status === 'interrupted' ? '已中断' : '完成'}</Badge></div>
        {#if entry.role === 'tool' || entry.role === 'system'}
          <details class="tool-output"><summary>{entry.toolName === 'reasoning' ? '查看思考摘要' : entry.toolName || '查看工具输出'}</summary>{#if entry.role === 'system'}<MarkdownContent content={entry.content}/>{:else}<pre>{entry.content || '等待工具输出…'}</pre>{/if}</details>
        {:else}<div class="entry-content"><MarkdownContent content={entry.content}/></div>{/if}
      </article>
    {/each}
    {#if !entries.length && !loading && !error}<p class="subagent-feedback">尚无过程消息，新的活动会显示在这里。</p>{/if}
  </div>
  {#if unread}<div class="subagent-new"><Button variant="secondary" size="sm" onclick={latest}>有新内容 · 查看最新</Button></div>{/if}
</SubagentDialog>
