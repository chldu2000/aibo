<script lang="ts">
  import { activeUiKit } from '../registry';

  let props: Record<string, any> = $props();
  const Component = $derived($activeUiKit.Button);
</script>

<Component {...props} />
