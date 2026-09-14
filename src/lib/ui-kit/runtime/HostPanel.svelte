<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiHostPanelProps } from '../contract';
  let props: UiHostPanelProps = $props();
  const Component = $derived($activeUiKit.HostPanel);
</script>
<Component {...props} />
