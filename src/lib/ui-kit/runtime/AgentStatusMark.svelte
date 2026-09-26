<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiAgentStatusMarkProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiAgentStatusMarkProps = $props();
  const Component = $derived($activeUiKit.AgentStatusMark);
</script>

<PublicControl control="AgentStatusMark" {props}><Component {...props} /></PublicControl>
