<script lang="ts">
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSubagentCardProps } from '../../contract';
  let { name, task, statusLabel, activity, failed, onOpen }: UiSubagentCardProps = $props();
</script>
<button class="subagent-card" class:failed onclick={onOpen} aria-label={`查看 ${name} 的工作过程`} data-ui-component="subagent-card">
  <span class="heading"><Icon name="branch" size={18} /><strong>{name}</strong><span role="status">{statusLabel}</span><Icon name="chevron-down" size={16} /></span>
  <span class="task">{task || '子 Agent 任务'}</span>
  <span class="activity">{activity || '等待活动记录…'}</span>
  <span class="open-hint">查看工作过程</span>
</button>
