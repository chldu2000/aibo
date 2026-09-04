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
  class={cn('m3-aibo-separator', orientation === 'vertical' ? 'm3-aibo-separator-vertical' : 'm3-aibo-separator-horizontal', className)}
  {...restProps}
></div>
