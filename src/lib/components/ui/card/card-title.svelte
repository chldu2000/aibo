<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<h3 data-slot="card-title" class={cn('text-sm font-semibold leading-none tracking-tight', className)} {...restProps}>
  {@render children?.()}
</h3>
