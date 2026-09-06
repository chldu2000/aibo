<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLInputAttributes = $props();
</script>

<input
  data-slot="input"
  bind:value
  class={cn(
    'flex h-9 min-w-0 w-full rounded-[var(--radius)] border border-[var(--input)] bg-[var(--background)] px-3 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50 aria-invalid:border-[var(--destructive)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--destructive)]/20 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
/> 
