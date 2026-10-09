<script lang="ts">
  import type { UiAgentStatusMarkProps } from '../../contract';

  let { agent, icon, tone, label }: UiAgentStatusMarkProps = $props();
</script>

<span class={`agent-status-mark md-agent-status-mark agent-${agent} tone-${tone}`} role="img" aria-label={label}>
  {#if tone === 'running'}
  <svg class="agent-status-orbit md-agent-status-track" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="9" pathLength="100" />
  </svg>
  {/if}
  <svg class="agent-status-logo" viewBox="0 0 24 24" aria-hidden="true">
    {#if icon}<path d={icon.path} fill="currentColor" />
    {:else}<!-- Generic agent (bot) glyph; an empty circle read as a radio button or status dot. -->
    <path d="M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3ZM12 4v4M9.5 14h.01M14.5 14h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />{/if}
  </svg>
</span>
