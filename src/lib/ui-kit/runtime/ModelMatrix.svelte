<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiModelMatrixProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiModelMatrixProps = $props();
  const Component = $derived($activeUiKit.ModelMatrix);
</script>

<PublicControl control="ModelMatrix" {props}><Component {...props} /></PublicControl>
