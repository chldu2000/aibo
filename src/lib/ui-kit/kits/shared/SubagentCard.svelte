<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSubagentCardProps } from '../../contract';
  let { name, task, statusLabel, activity, failed, onOpen }: UiSubagentCardProps = $props();
</script>
<button class="subagent-card" class:failed onclick={onOpen} aria-label={$t('subagent.viewProcessLabel', { name })} data-ui-component="subagent-card">
  <span class="heading"><Icon name="branch" size={18} /><strong>{name}</strong><span role="status">{statusLabel}</span><Icon name="chevron-down" size={16} /></span>
  <span class="task">{task || $t('subagent.defaultTask')}</span>
  <span class="activity">{activity || $t('subagent.waitingActivity')}</span>
  <span class="open-hint">{$t('subagent.viewProcess')}</span>
</button>
