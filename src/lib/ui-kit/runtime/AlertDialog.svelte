<script lang="ts">
  import { activeUiKit } from '../registry';

  let props: Record<string, any> = $props();
  const Component = $derived($activeUiKit.AlertDialog);
</script>

<Component {...props} />
