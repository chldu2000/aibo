<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiManagementCenterProps } from '../contract';
  let props: UiManagementCenterProps = $props();
  const Component = $derived($activeUiKit.ManagementCenter);
</script>

<Component {...props} />
