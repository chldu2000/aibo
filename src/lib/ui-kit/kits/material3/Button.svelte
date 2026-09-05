<script lang="ts">
  import { Button as M3Button } from 'm3-svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import type { UiButtonVariant } from '../../contract';

  type ButtonVariant = UiButtonVariant;
  type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';
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

  const variantMap: Record<ButtonVariant, 'filled' | 'tonal' | 'outlined' | 'text'> = {
    default: 'filled',
    secondary: 'tonal',
    destructive: 'filled',
    toolbar: 'text',
    queue: 'outlined',
    abort: 'filled',
    send: 'filled',
    outline: 'outlined',
    ghost: 'text',
    link: 'text',
  };
  const sizeMap: Record<ButtonSize, 'xs' | 's' | 'm'> = {
    icon: 'xs',
    sm: 'xs',
    default: 's',
    lg: 'm',
  };
</script>

{#if variant === 'ghost' || variant === 'link'}
  <button
    data-slot="button"
    class={cn(
      'm3-aibo-button m3-layer',
      `m3-aibo-button-${variant}`,
      `m3-aibo-button-size-${size}`,
      size === 'icon' && 'm3-aibo-icon-button',
      className,
    )}
    {type}
    {...restProps}
  >
    {@render children?.()}
  </button>
{:else}
  <M3Button
    data-slot="button"
    variant={variantMap[variant]}
    size={sizeMap[size]}
    iconType={size === 'icon' ? 'full' : 'none'}
    class={cn(
      'm3-aibo-button',
      `m3-aibo-button-${variant}`,
      `m3-aibo-button-size-${size}`,
      size === 'icon' && 'm3-aibo-icon-button',
      className,
    )}
    {type}
    {...restProps}
  >
    {@render children?.()}
  </M3Button>
{/if}
