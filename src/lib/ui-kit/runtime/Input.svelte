<script lang="ts">
  import { activeUiKit } from '../registry';

  let { value = $bindable(), ...restProps }: Record<string, any> = $props();
  const Component = $derived($activeUiKit.Input);
</script>

<Component bind:value {...restProps} />
