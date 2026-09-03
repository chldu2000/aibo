<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type SeparatorProps = HTMLAttributes & { orientation?: 'horizontal' | 'vertical' };
  let { orientation = 'horizontal', class: className, ...restProps }: SeparatorProps = $props();
</script>

<div
  data-slot="separator"
  role="separator"
  aria-orientation={orientation}
  class={cn(
    'shrink-0 bg-[var(--aibo-border)]',
    orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
    className,
  )}
  {...restProps}
></div>
