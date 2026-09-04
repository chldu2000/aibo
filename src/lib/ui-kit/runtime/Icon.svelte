<script lang="ts">
  import { activeUiKit } from '../registry';

  let props: Record<string, any> = $props();
  const Component = $derived($activeUiKit.Icon);
</script>

<Component {...props} />
