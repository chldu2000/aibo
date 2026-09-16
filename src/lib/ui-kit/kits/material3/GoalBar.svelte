<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Icon from './Icon.svelte';
  import { Icon as MaterialIcon } from 'm3-svelte';
  import expandGoal from '@ktibow/iconset-material-symbols/fullscreen-rounded';
  import collapseGoal from '@ktibow/iconset-material-symbols/fullscreen-exit-rounded';
  import type { UiGoalBarProps } from '../../contract';
  let { objective, statusLabel, usageLabel, busy = false, onClear, onPause, onResume }: UiGoalBarProps = $props();
  let expanded = $state(false);
</script>
<section class="goal-bar" aria-label="当前目标" data-ui-component="goal-bar">
  <Icon name="focus" size={18} />
  <div class="goal-copy" class:expanded>
    <p title={objective}>{objective}</p>
    <small role="status">{statusLabel}{#if usageLabel} · {usageLabel}{/if}</small>
  </div>
  {#if onPause}<Button variant="ghost" size="icon" disabled={busy} onclick={onPause} title="暂停目标并停止当前回合" aria-label="暂停目标"><Icon name="pause" size={18} /></Button>{/if}
  {#if onResume}<Button variant="ghost" size="icon" disabled={busy} onclick={onResume} title="继续执行目标" aria-label="恢复目标"><Icon name="play" size={18} /></Button>{/if}
  {#if onClear}<Button variant="ghost" size="icon" disabled={busy} onclick={onClear} title="清除目标" aria-label="清除目标"><Icon name="delete" size={16} /></Button>{/if}
  <Button variant="ghost" size="icon" onclick={() => expanded = !expanded} aria-expanded={expanded} title={expanded ? '收起目标' : '展开目标'} aria-label={expanded ? '收起目标' : '展开目标'}><MaterialIcon icon={expanded ? collapseGoal : expandGoal} size={20} aria-hidden="true" /></Button>
</section>
<style>
  .goal-bar { display: flex; align-items: center; gap: 10px; min-width: 0; margin: 8px 16px 0; padding: 12px 16px; background: var(--m3c-surface-container-high); color: var(--m3c-on-surface); border: 1px solid var(--m3c-outline-variant); border-radius: 24px 24px 0 0; }
  .goal-copy { flex: 1; min-width: 0; }
  p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.6; }
  .expanded p { white-space: normal; overflow-wrap: anywhere; }
  small { color: var(--m3c-on-surface-variant); font-size: 12px; }
</style>
