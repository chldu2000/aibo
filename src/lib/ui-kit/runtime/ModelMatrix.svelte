<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiModelMatrixProps } from '../contract';

  let props: UiModelMatrixProps = $props();
  const Component = $derived($activeUiKit.ModelMatrix);
</script>

<Component {...props} />
