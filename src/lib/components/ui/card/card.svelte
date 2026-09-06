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

<svelte:element
  this={as}
  data-slot="card"
  class={cn(
    'rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
