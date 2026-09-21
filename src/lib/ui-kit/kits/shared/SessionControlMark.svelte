<script lang="ts">
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSessionControlMarkProps } from '../../contract';
  import { sessionControlAppearance } from '../../session-control-appearance';
  let { control, compact = false }: UiSessionControlMarkProps = $props();
  const appearance = $derived(sessionControlAppearance(control));
</script>

<span class="session-control-mark" class:compact data-tone={appearance.tone} aria-hidden="true">
  <Icon name={appearance.icon} size={16} />
</span>

<style>
  .session-control-mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: 7px; color: var(--aibo-subtle); background: color-mix(in srgb, currentColor 11%, transparent); }
  .session-control-mark[data-tone='info'] { color: var(--aibo-session-info, var(--aibo-accent-text)); }
  .session-control-mark[data-tone='plan'] { color: var(--aibo-session-plan, var(--aibo-accent-text)); }
  .session-control-mark[data-tone='write'] { color: var(--aibo-session-write, var(--aibo-success-text)); }
  .session-control-mark[data-tone='elevated'] { color: var(--aibo-session-elevated, var(--aibo-warning-text)); }
  .compact { width: 20px; height: 20px; border-radius: 5px; }
</style>
