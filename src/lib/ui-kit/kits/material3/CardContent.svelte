<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<div data-slot="card-content" class={cn('m3-aibo-card-content', className)} {...restProps}>
  {@render children?.()}
</div>
