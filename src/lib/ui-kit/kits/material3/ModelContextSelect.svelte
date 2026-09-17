<script lang="ts">
  import type { UiModelContextSelectProps } from '../../contract';
  let { options, current, disabled, onSelect }: UiModelContextSelectProps = $props();
  const known = $derived(options.some(option => option.id === current));
</script>

<label class="context-window-select">
  <span>上下文</span>
  <select aria-label="模型上下文大小" value={known ? current ?? '' : ''}
    disabled={disabled || options.length === 0}
    title={options.find(option => option.id === current)?.description ?? '选择当前模型的上下文大小'}
    onchange={(event) => { const value = event.currentTarget.value; event.currentTarget.value = known ? current ?? '' : ''; if (!disabled && options.some(option => option.id === value)) void onSelect(value); }}>
    {#if !known}<option value="" disabled>{options.length ? '未提供当前值' : '不支持'}</option>{/if}
    {#each options as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
  </select>
</label>

<style>
  .context-window-select { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; white-space: nowrap; }
  select { max-width: 10rem; min-height: 2rem; padding: 0.25rem 0.5rem; border: 1px solid var(--m3c-outline-variant); border-radius: 1rem; background: var(--m3c-surface-container); color: var(--m3c-on-surface); font: inherit; }
  select:focus-visible { outline: 2px solid var(--m3c-primary); outline-offset: 2px; }
  select:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
