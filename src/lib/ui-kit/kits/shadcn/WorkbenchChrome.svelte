<script lang="ts">
  import type { UiWorkbenchChromeProps } from '../../contract';
  let { layout, children }: UiWorkbenchChromeProps = $props();
</script>

<div class="workbench-chrome" data-layout={layout}>{@render children()}</div>

<style>
  .workbench-chrome { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--aibo-bg); }
  .workbench-chrome :global(.workspace-grid) { padding-top: 0; }
  .workbench-chrome :global(.sidebar), .workbench-chrome :global(.timeline), .workbench-chrome :global(.inspector) { border-radius: 0; box-shadow: none; }
  .workbench-chrome :global(.sidebar) { border-width: 0 1px 0 0; border-color: var(--aibo-border); background: color-mix(in srgb, var(--aibo-surface) 42%, var(--aibo-bg)); }
  .workbench-chrome :global(.timeline) { border: 0; background: var(--aibo-bg); }
  .workbench-chrome :global(.inspector) { border-width: 0 0 0 1px; border-color: var(--aibo-border); background: color-mix(in srgb, var(--aibo-surface) 34%, var(--aibo-bg)); }
  .workbench-chrome :global(.panel-heading) { min-height: 3rem; border-bottom: 1px solid var(--aibo-border); }
  .workbench-chrome :global(.workspace-item-row), .workbench-chrome :global(.session-item-row) { border-radius: .35rem; }
  .workbench-chrome :global(.session-item-row.selected) { background: var(--aibo-accent-soft); box-shadow: inset 2px 0 0 var(--aibo-accent); }
  .workbench-chrome :global(.timeline-entry) { border-radius: .4rem; box-shadow: none; }
  .workbench-chrome :global(.composer) { margin: 0 .875rem .875rem; border-radius: .65rem; border-color: var(--aibo-border-strong); background: var(--aibo-surface); box-shadow: 0 .5rem 1.5rem #0004; }
  .workbench-chrome :global(.composer-textarea) { font-family: ui-sans-serif, system-ui, sans-serif; }
  .workbench-chrome :global(.composer-menu), .workbench-chrome :global(.composer-suggestions) { border-radius: .5rem; }
</style>
