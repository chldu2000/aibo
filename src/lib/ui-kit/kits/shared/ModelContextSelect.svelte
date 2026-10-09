<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import Select from '../../runtime/Select.svelte';
  import type { UiModelContextSelectProps } from '../../contract';
  let { options, current, disabled, onSelect }: UiModelContextSelectProps = $props();
  const known = $derived(options.some(option => option.id === current));
</script>

<label class="context-window-select">
  <span>{$t('side.context')}</span>
  <Select aria-label={$t('context.size')} value={known ? current ?? '' : ''}
    disabled={disabled || options.length === 0}
    placeholder={options.length ? $t('context.noCurrent') : $t('context.unsupported')}
    title={options.find(option => option.id === current)?.description ?? $t('context.choose')}
    options={options.map(option => ({value:option.id,label:option.label}))}
    onSelect={value => { if (!disabled && options.some(option => option.id === value)) void onSelect(value); }} />
</label>
