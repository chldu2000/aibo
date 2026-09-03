<script lang="ts" module>
  export { buttonVariants } from './button-variants';
  export type { ButtonSize, ButtonVariant } from './button-variants';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { buttonVariants, type ButtonSize, type ButtonVariant } from './button-variants';

  type ButtonProps = HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children?: Snippet;
  };

  let {
    class: className,
    variant = 'default',
    size = 'default',
    type = 'button',
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

<button
  data-slot="button"
  class={cn(buttonVariants({ variant, size }), className)}
  {type}
  {...restProps}
>
  {@render children?.()}
</button>
