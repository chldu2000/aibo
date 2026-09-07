<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark m3-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  <span class="agent-status-orbit" aria-hidden="true"></span>
  <span class="agent-status-logo" aria-hidden="true"></span>
  <span class="agent-status-signal" aria-hidden="true"></span>
</span>
