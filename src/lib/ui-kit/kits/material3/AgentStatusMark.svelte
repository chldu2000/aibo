<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, icon, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark m3-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  <span class="agent-status-orbit" aria-hidden="true"></span>
  <svg class="agent-status-logo" viewBox="0 0 24 24" aria-hidden="true">
    {#if icon}<path d={icon.path} fill="currentColor" />
    {:else}<path d="M12 2 22 12 12 22 2 12Z" fill="none" stroke="currentColor" stroke-width="2" />{/if}
  </svg>
  <span class="agent-status-signal" aria-hidden="true"></span>
</span>
