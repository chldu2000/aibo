<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark shadcn-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  <svg class="agent-status-orbit shadcn-agent-status-track" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="1" y="1" width="18" height="18" rx="4" pathLength="100" />
  </svg>
  <span class="agent-status-logo" aria-hidden="true"></span>
  <span class="agent-status-signal" aria-hidden="true"></span>
</span>
