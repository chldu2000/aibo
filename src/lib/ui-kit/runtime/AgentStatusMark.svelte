<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiAgentStatusMarkProps } from '../contract';

  let props: UiAgentStatusMarkProps = $props();
  const Component = $derived($activeUiKit.AgentStatusMark);
</script>

<Component {...props} />
