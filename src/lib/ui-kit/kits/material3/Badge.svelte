<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  type BadgeProps = HTMLAttributes & { variant?: BadgeVariant; children?: Snippet };
  let { class: className, variant = 'default', children, ...restProps }: BadgeProps = $props();
</script>

<span data-slot="badge" class={cn('m3-aibo-badge', `m3-aibo-badge-${variant}`, className)} {...restProps}>
  {@render children?.()}
</span>
