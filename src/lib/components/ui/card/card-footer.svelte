<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLAttributes & { children?: Snippet } = $props();
</script>

<div data-slot="card-footer" class={cn('flex items-center p-6 pt-0', className)} {...restProps}>
  {@render children?.()}
</div>
