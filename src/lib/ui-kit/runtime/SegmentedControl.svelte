<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSegmentedControlProps } from '../contract';
  let props: UiSegmentedControlProps = $props();
  const Component = $derived($activeUiKit.SegmentedControl);
</script>
<Component {...props} />
