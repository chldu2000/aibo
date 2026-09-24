<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, icon, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark ak-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  {#if tone === 'running'}
  <svg class="agent-status-orbit ak-agent-status-track" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="9" pathLength="100" />
  </svg>
  {/if}
  <svg class="agent-status-logo" viewBox="0 0 24 24" aria-hidden="true">
    {#if icon}<path d={icon.path} fill="currentColor" />
    {:else}<path d="M12 3 21 12 12 21 3 12Z" fill="none" stroke="currentColor" stroke-width="1.6" />{/if}
  </svg>
</span>
