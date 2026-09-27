<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSubagentCardProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiSubagentCardProps = $props();
  const Component = $derived($activeUiKit.SubagentCard);
</script>

<PublicControl control="SubagentCard" {props}><Component {...props} /></PublicControl>
