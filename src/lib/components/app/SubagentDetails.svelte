<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { tick, untrack } from 'svelte';
  import { SubagentDialog, Badge, Button } from '$lib/ui-kit';
  import MarkdownContent from './MarkdownContent.svelte';
  import { type SubagentTask, type SubagentEntry } from '$lib/app/subagents';
  let {open, agent, entries, loading, error, onClose, onRetry, onOpenLink}: {
    open: boolean; agent: SubagentTask; entries: SubagentEntry[]; loading: boolean; error: string | null;
    onClose: () => void; onRetry: () => void;
    onOpenLink?: (url: string) => void;
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
<SubagentDialog {open} title={agent.name} task={agent.task} statusLabel={$t(`subagent.status.${agent.status}`)} {onClose}>
  {#if loading}<p class="subagent-feedback" role="status">{$t('subagent.loading')}</p>{/if}
  {#if error}<div class="subagent-feedback" role="alert">{error}<Button variant="outline" size="sm" onclick={onRetry}>{$t('common.retry')}</Button></div>{/if}
  <div class="subagent-feed" bind:this={feed} onscroll={savePosition}>
    {#each entries as entry (entry.id)}
      <article class="subagent-entry">
        <div class="entry-meta"><Badge variant="outline">{entry.role === 'assistant' ? agent.name : entry.role === 'tool' ? $t('role.tool') : entry.role === 'system' ? $t('subagent.reasoningSummary') : $t('subagent.task')}</Badge><Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>{entry.status === 'streaming' ? $t('subagent.inProgress') : entry.status === 'failed' ? $t('subagent.failed') : entry.status === 'interrupted' ? $t('subagent.interrupted') : $t('common.done')}</Badge></div>
        {#if entry.role === 'tool' || entry.role === 'system'}
          <details class="tool-output"><summary>{entry.toolName === 'reasoning' ? $t('subagent.viewReasoning') : entry.toolName || $t('subagent.viewTool')}</summary>{#if entry.role === 'system'}<MarkdownContent {onOpenLink} content={entry.content}/>{:else}<pre>{entry.content || $t('subagent.waitingOutput')}</pre>{/if}</details>
        {:else}<div class="entry-content"><MarkdownContent {onOpenLink} content={entry.content}/></div>{/if}
      </article>
    {/each}
    {#if !entries.length && !loading && !error}<p class="subagent-feedback">{$t('subagent.noActivity')}</p>{/if}
  </div>
  {#if unread}<div class="subagent-new"><Button variant="secondary" size="sm" onclick={latest}>{$t('subagent.newContent')}</Button></div>{/if}
</SubagentDialog>
