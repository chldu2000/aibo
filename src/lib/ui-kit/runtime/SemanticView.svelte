<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { PresentationProps } from '../presentation-props';
  let props: PresentationProps = $props();
  const Component = $derived($activeUiKit.SemanticView);
</script>
<Component {...props} />
