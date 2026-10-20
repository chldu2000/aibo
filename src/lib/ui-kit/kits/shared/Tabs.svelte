<script lang="ts">
  import Button from './Button.svelte';
  import type { UiTabsProps } from '../../contract';
  let { label, idPrefix, items, value, onSelect }: UiTabsProps = $props();
  let list = $state<HTMLDivElement>();
  function move(event: KeyboardEvent, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    // Nested tabs must not also move an enclosing navigation.
    event.preventDefault(); event.stopPropagation();
    onSelect(items[next].id);
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
</script>

<div class="ui-tabs" role="tablist" aria-label={label} data-ui-component="tabs" bind:this={list}>
  {#each items as item, index (item.id)}
    <Button id="{idPrefix}-tab-{item.id}" variant="ghost" size="sm" role="tab" aria-controls="{idPrefix}-panel"
      aria-selected={value === item.id} tabindex={value === item.id ? 0 : -1}
      onkeydown={(event: KeyboardEvent) => move(event, index)} onclick={() => onSelect(item.id)}>{item.label}</Button>
  {/each}
</div>
