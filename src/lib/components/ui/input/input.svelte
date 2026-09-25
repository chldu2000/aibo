<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLInputAttributes = $props();
</script>

<input
  data-slot="input"
  bind:value
  class={cn('flex h-9 min-w-0 w-full px-3 py-1',
    className,
  )}
  {...restProps}
/> 
