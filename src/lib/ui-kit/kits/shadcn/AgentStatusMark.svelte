<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, icon, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark shadcn-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  <svg class="agent-status-orbit shadcn-agent-status-track" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="1" y="1" width="18" height="18" rx="4" pathLength="100" />
  </svg>
  <svg class="agent-status-logo" viewBox="0 0 24 24" aria-hidden="true">
    {#if icon}<path d={icon.path} fill="currentColor" />
    {:else}<path d="M12 2 22 12 12 22 2 12Z" fill="none" stroke="currentColor" stroke-width="2" />{/if}
  </svg>
  <span class="agent-status-signal" aria-hidden="true"></span>
</span>
