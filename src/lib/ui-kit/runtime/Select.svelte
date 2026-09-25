<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSelectProps } from '../contract';
  let props: UiSelectProps = $props();
  const Component = $derived($activeUiKit.Select);
</script>
<Component {...props} />
