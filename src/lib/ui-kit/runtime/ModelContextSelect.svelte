<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiModelContextSelectProps } from '../contract';
  let props: UiModelContextSelectProps = $props();
  const Component = $derived($activeUiKit.ModelContextSelect);
</script>

<Component {...props} />
