<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiModelContextSelectProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiModelContextSelectProps = $props();
  const Component = $derived($activeUiKit.ModelContextSelect);
</script>

<PublicControl control="ModelContextSelect" {props}><Component {...props} /></PublicControl>
