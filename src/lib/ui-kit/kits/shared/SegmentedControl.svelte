<script lang="ts">
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSegmentedControlProps } from '../../contract';
  let { label, name, options, value, disabled = false, onSelect }: UiSegmentedControlProps = $props();
</script>

<div class="ui-segmented" role="radiogroup" aria-label={label} data-ui-component="segmented-control">
  {#each options as option (option.value)}
    <label class="ui-segmented-option" class:active={value === option.value} class:unavailable={option.disabled}>
      <input type="radio" {name} value={option.value} aria-label={option.label} checked={value === option.value}
        disabled={disabled || option.disabled} onchange={() => onSelect(option.value)} />
      <span class="ui-segmented-mark" aria-hidden="true">{#if value === option.value}<Icon name="check" size={16} />{/if}</span>
      <span>{option.label}</span>
    </label>
  {/each}
</div>
