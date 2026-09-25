<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
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
  <div class="goal-actions">
  {#if onPause}<Button variant="ghost" size="icon" disabled={busy} onclick={onPause} title="暂停目标并停止当前回合" aria-label="暂停目标"><Icon name="pause" size={18} /></Button>{/if}
  {#if onResume}<Button variant="ghost" size="icon" disabled={busy} onclick={onResume} title="继续执行目标" aria-label="恢复目标"><Icon name="play" size={18} /></Button>{/if}
  {#if onClear}<Button variant="ghost" size="icon" disabled={busy} onclick={onClear} title="清除目标" aria-label="清除目标"><Icon name="delete" size={16} /></Button>{/if}
  <Button variant="ghost" size="icon" onclick={() => expanded = !expanded} aria-expanded={expanded} title={expanded ? '收起目标' : '展开目标'} aria-label={expanded ? '收起目标' : '展开目标'}><Icon name={expanded ? 'window-minimize' : 'window-maximize'} size={16} /></Button>
  </div>
</section>
