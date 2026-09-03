<script lang="ts" module>
  export { badgeVariants } from './badge-variants';
  export type { BadgeVariant } from './badge-variants';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { badgeVariants, type BadgeVariant } from './badge-variants';

  type BadgeProps = HTMLAttributes & {
    variant?: BadgeVariant;
    children?: Snippet;
  };

  let { class: className, variant = 'default', children, ...restProps }: BadgeProps = $props();
</script>

<span data-slot="badge" class={cn(badgeVariants({ variant }), className)} {...restProps}>
  {@render children?.()}
</span>
