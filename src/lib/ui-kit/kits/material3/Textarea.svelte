<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { value = $bindable(), class: className, ...restProps }: HTMLTextareaAttributes = $props();
</script>

<textarea data-slot="textarea" bind:value class={cn('m3-aibo-textarea', className)} {...restProps}></textarea>
