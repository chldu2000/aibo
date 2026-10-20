<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiTabsProps } from '../contract';
  let props: UiTabsProps = $props();
  const Component = $derived($activeUiKit.Tabs);
</script>
<Component {...props} />
