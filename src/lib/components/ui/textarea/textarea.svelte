<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let { value = $bindable(), class: className, ...restProps }: HTMLTextareaAttributes = $props();
</script>

<textarea
  data-slot="textarea"
  bind:value
  class={cn('flex min-h-20 min-w-0 w-full px-3 py-2',
    className,
  )}
  {...restProps}
></textarea>
