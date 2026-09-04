<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<div data-slot="card-header" class={cn('m3-aibo-card-header', className)} {...restProps}>
  {@render children?.()}
</div>
