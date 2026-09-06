<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLTextareaAttributes = $props();
</script>

<textarea
  data-slot="textarea"
  bind:value
  class={cn(
    'flex min-h-20 min-w-0 w-full rounded-[var(--radius)] border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/50 aria-invalid:border-[var(--destructive)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--destructive)]/20 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  )}
  {...restProps}
></textarea>
