<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiManagementDataViewProps } from '../contract';
  let props: UiManagementDataViewProps = $props();
  const Component = $derived($activeUiKit.ManagementDataView);
</script>
<Component {...props} />
