<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLInputAttributes = $props();
</script>

<input
  data-slot="input"
  bind:value
  class={cn(
    'flex h-9 w-full rounded-md border border-[var(--aibo-border-strong)] bg-transparent px-3 py-1 text-xs text-[var(--aibo-text)] shadow-sm outline-none transition-colors placeholder:text-[var(--aibo-subtle)] focus-visible:border-[var(--aibo-focus)] focus-visible:ring-2 focus-visible:ring-[var(--aibo-focus)]/20 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
/> 
