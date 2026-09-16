<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiAgentSettingsFormProps } from '../contract';
  let props: UiAgentSettingsFormProps = $props();
  const Component = $derived($activeUiKit.AgentSettingsForm);
</script>
<Component {...props} />
