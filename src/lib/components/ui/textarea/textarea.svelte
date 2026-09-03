<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLTextareaAttributes = $props();
</script>

<textarea
  data-slot="textarea"
  bind:value
  class={cn(
    'flex min-h-20 w-full rounded-md border border-[var(--aibo-border-strong)] bg-transparent px-3 py-2 text-xs text-[var(--aibo-text)] shadow-sm outline-none transition-colors placeholder:text-[var(--aibo-subtle)] focus-visible:border-[var(--aibo-focus)] focus-visible:ring-2 focus-visible:ring-[var(--aibo-focus)]/20 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
></textarea>
