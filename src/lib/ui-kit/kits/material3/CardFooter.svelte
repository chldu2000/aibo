<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<div data-slot="card-footer" class={cn('m3-aibo-card-footer', className)} {...restProps}>
  {@render children?.()}
</div>
