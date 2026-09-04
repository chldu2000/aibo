<script lang="ts">
  import { activeUiKit } from '../registry';

  let { value = $bindable(), ...restProps }: Record<string, any> = $props();
  const Component = $derived($activeUiKit.Textarea);
</script>

<Component bind:value {...restProps} />
