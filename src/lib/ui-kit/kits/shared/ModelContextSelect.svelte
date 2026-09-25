<script lang="ts">
  import Select from '../../runtime/Select.svelte';
  import type { UiModelContextSelectProps } from '../../contract';
  let { options, current, disabled, onSelect }: UiModelContextSelectProps = $props();
  const known = $derived(options.some(option => option.id === current));
</script>

<label class="context-window-select">
  <span>上下文</span>
  <Select aria-label="模型上下文大小" value={known ? current ?? '' : ''}
    disabled={disabled || options.length === 0}
    placeholder={options.length ? '未提供当前值' : '不支持'}
    title={options.find(option => option.id === current)?.description ?? '选择当前模型的上下文大小'}
    options={options.map(option => ({value:option.id,label:option.label}))}
    onSelect={value => { if (!disabled && options.some(option => option.id === value)) void onSelect(value); }} />
</label>
