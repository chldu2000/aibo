<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { UiButtonVariant } from '../../contract';
  let { class: className = '', variant = 'default', size = 'default', type = 'button', children, ...rest }: HTMLButtonAttributes & {
    variant?: UiButtonVariant; size?: 'default' | 'sm' | 'icon'; children?: Snippet;
  } = $props();
</script>
<button data-slot="button" data-variant={variant} data-size={size} class={`ui-button ${className}`} {type} {...rest}>{@render children?.()}</button>
