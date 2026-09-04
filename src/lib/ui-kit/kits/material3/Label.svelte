<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, children, ...restProps }: HTMLLabelAttributes & { children?: Snippet } = $props();
</script>

<label data-slot="label" class={cn('m3-aibo-label', className)} {...restProps}>
  {@render children?.()}
</label>
