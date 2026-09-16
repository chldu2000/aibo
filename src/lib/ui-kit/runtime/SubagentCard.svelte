<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSubagentCardProps } from '../contract';
  let props: UiSubagentCardProps = $props();
  const Component = $derived($activeUiKit.SubagentCard);
</script>
<Component {...props} />
