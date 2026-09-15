<script lang="ts">
  import type { UiWorkbenchChromeProps } from '../../contract';
  let { layout, children }: UiWorkbenchChromeProps = $props();
</script>

<div class="workbench-chrome" data-layout={layout}>{@render children()}</div>

<style>
  .workbench-chrome { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; padding: .5rem; background: var(--m3c-surface); }
  .workbench-chrome :global(.workspace-grid) { gap: .5rem; padding-top: 0; }
  .workbench-chrome :global(.sidebar), .workbench-chrome :global(.timeline), .workbench-chrome :global(.inspector) { border: 0; border-radius: var(--m3-shape-large); box-shadow: none; }
  .workbench-chrome :global(.sidebar) { background: var(--m3c-surface-container-low); }
  .workbench-chrome :global(.timeline) { background: color-mix(in srgb, var(--m3c-surface-container) 52%, var(--m3c-surface)); }
  .workbench-chrome :global(.inspector) { background: var(--m3c-surface-container-low); }
  .workbench-chrome :global(.panel-heading) { min-height: 3.5rem; border-bottom: 0; padding-inline: 1rem; }
  .workbench-chrome :global(.workspace-item-row), .workbench-chrome :global(.session-item-row) { border-radius: var(--m3-shape-full); }
  .workbench-chrome :global(.session-item-row.selected) { background: var(--m3c-secondary-container); }
  .workbench-chrome :global(.session-item-row.selected .session-item-label) { color: var(--m3c-on-secondary-container); font-weight: 500; }
  .workbench-chrome :global(.timeline-entry) { border: 0; border-radius: var(--m3-shape-large); background: var(--m3c-surface-container); box-shadow: var(--m3-elevation-1); }
  .workbench-chrome :global(.tool-entry), .workbench-chrome :global(.system-entry) { background: var(--m3c-surface-container-high); }
  .workbench-chrome :global(.composer) { margin: 0 1rem 1rem; border: 0; border-radius: 1.75rem; background: var(--m3c-surface-container-high); box-shadow: var(--m3-elevation-1); }
  .workbench-chrome :global(.composer:focus-within) { box-shadow: var(--m3-elevation-2), 0 0 0 2px var(--m3c-primary); }
  .workbench-chrome :global(.composer-toolbar-icon), .workbench-chrome :global(.composer-action) { border-radius: var(--m3-shape-full); }
  .workbench-chrome :global(.composer-menu), .workbench-chrome :global(.composer-suggestions) { border: 0; border-radius: var(--m3-shape-large); background: var(--m3c-surface-container-high); box-shadow: var(--m3-elevation-2); }
  .workbench-chrome :global(.inspector-empty), .workbench-chrome :global(.timeline-empty) { border: 0; border-radius: var(--m3-shape-large); background: var(--m3c-surface-container); }
  @media (max-width: 700px) { .workbench-chrome { padding: 0; } }
</style>
