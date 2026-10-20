<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiGoalBarProps } from '../../contract';
  let { objective, statusLabel, usageLabel, busy = false, onClear, onPause, onResume }: UiGoalBarProps = $props();
  let expanded = $state(false);
</script>
<!-- Collapsed: one line with objective, status and usage. Expanded: the objective wraps and the status moves below it. -->
<section class="goal-bar" class:expanded aria-label={$t('goal.current')} data-ui-component="goal-bar">
  <Icon name="target" size={16} />
  <div class="goal-copy">
    <p title={objective}>{objective}</p>
    <small role="status"><span>{statusLabel}</span>{#if usageLabel}<span class="goal-usage">{usageLabel}</span>{/if}</small>
  </div>
  <div class="goal-actions">
  {#if onPause}<Button variant="ghost" size="icon" disabled={busy} onclick={onPause} title={$t('goal.pauseHint')} aria-label={$t('goal.pause')}><Icon name="pause" size={16} /></Button>{/if}
  {#if onResume}<Button variant="ghost" size="icon" disabled={busy} onclick={onResume} title={$t('goal.resumeHint')} aria-label={$t('goal.resume')}><Icon name="play" size={16} /></Button>{/if}
  {#if onClear}<Button variant="ghost" size="icon" disabled={busy} onclick={onClear} title={$t('goal.clear')} aria-label={$t('goal.clear')}><Icon name="delete" size={16} /></Button>{/if}
  <Button variant="ghost" size="icon" onclick={() => expanded = !expanded} aria-expanded={expanded} title={expanded ? $t('goal.collapse') : $t('goal.expand')} aria-label={expanded ? $t('goal.collapse') : $t('goal.expand')}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} /></Button>
  </div>
</section>
