<script lang="ts">
  import Form from './AgentSettingsForm.svelte';
  import type { UiAgentSettingsFormProps } from '../../contract';
  let props: UiAgentSettingsFormProps = $props();
</script>
<div class="agent-settings-surface"><Form {...props} /></div>
