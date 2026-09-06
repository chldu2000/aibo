<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiColumnSplitterProps } from '../contract';

  let props: UiColumnSplitterProps = $props();
  const Component = $derived($activeUiKit.ColumnSplitter);
</script>

<Component {...props} />
