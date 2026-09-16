<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSubagentDialogProps } from '../contract';
  let props: UiSubagentDialogProps = $props();
  const Component = $derived($activeUiKit.SubagentDialog);
</script>
<Component {...props} />
