<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { value = $bindable(), class: className, ...restProps }: HTMLInputAttributes = $props();
</script>

<input data-slot="input" bind:value class={cn('m3-aibo-input', className)} {...restProps} />
