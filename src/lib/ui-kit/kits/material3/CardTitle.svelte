<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<h3 data-slot="card-title" class={cn('m3-aibo-card-title', className)} {...restProps}>
  {@render children?.()}
</h3>
