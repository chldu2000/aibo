<script lang="ts">
  import Icon from './Icon.svelte';
  import type { UiSubagentCardProps } from '../../contract';
  let { name, task, statusLabel, activity, failed, onOpen }: UiSubagentCardProps = $props();
</script>
<button class="subagent-card" class:failed onclick={onOpen} aria-label={`查看 ${name} 的工作过程`} data-ui-component="subagent-card">
  <span class="heading"><Icon name="branch" size={18} /><strong>{name}</strong><span role="status">{statusLabel}</span><Icon name="chevron-down" size={16} /></span>
  <span class="task">{task || '子 Agent 任务'}</span>
  <span class="activity">{activity || '等待活动记录…'}</span>
  <span class="open-hint">查看工作过程</span>
</button>
<style>
  .subagent-card { display:grid; gap:10px; width:100%; padding:16px; text-align:left; cursor:pointer; color:var(--aibo-text); border:1px solid var(--aibo-border); border-radius:12px; background:var(--aibo-surface); }
  .subagent-card:hover { border-color:var(--aibo-focus); }
  .subagent-card:focus-visible { outline:2px solid var(--aibo-focus); outline-offset:3px; }
  .heading { display:flex; align-items:center; gap:8px; font-size:12px; }
  strong { flex:1; min-width:0; overflow-wrap:anywhere; font-size:14px; }
  .task { font-size:13px; line-height:1.6; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
  .activity { color:var(--aibo-muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .open-hint { color:var(--aibo-muted); font-size:11px; }
  .failed { border-color:var(--aibo-warning-border); }
</style>
