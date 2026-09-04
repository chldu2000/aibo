<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type CardElement = 'article' | 'aside' | 'div' | 'form' | 'section';
  type CardProps = HTMLAttributes & {
    as?: CardElement;
    children?: Snippet;
  };

  let { as = 'div', class: className, children, ...restProps }: CardProps = $props();
</script>

<svelte:element this={as} data-slot="card" class={cn('m3-aibo-card', className)} {...restProps}>
  {@render children?.()}
</svelte:element>
