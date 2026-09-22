<script lang="ts">
  import type { UiWorkbenchChromeProps } from '../../contract';
  import Button from './Button.svelte';
  let { layout, children, auxiliaryOpen = true }: UiWorkbenchChromeProps = $props();
  let mobileRegion = $state<'navigation' | 'content' | 'auxiliary'>('content');
  $effect(() => { if (!auxiliaryOpen && mobileRegion === 'auxiliary') mobileRegion = 'content'; });
</script>
<div class="workbench-chrome" data-ak-ui data-layout={layout} data-mobile-region={mobileRegion}>
  <nav class="compact-region-navigation" aria-label="工作台区域">
    {#if layout !== 'focus'}<Button variant="ghost" aria-pressed={mobileRegion === 'navigation'} onclick={() => mobileRegion = 'navigation'}>工作区</Button>{/if}
    <Button variant="ghost" aria-pressed={mobileRegion === 'content' || layout === 'focus'} onclick={() => mobileRegion = 'content'}>会话</Button>
    {#if layout !== 'focus' && auxiliaryOpen}<Button variant="ghost" aria-pressed={mobileRegion === 'auxiliary'} onclick={() => mobileRegion = 'auxiliary'}>侧边栏</Button>{/if}
  </nav>
  {@render children()}
</div>
<style>
  .workbench-chrome { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--aibo-bg); }
  .compact-region-navigation { display: none; }
  @media (max-width: 900px) {
    .compact-region-navigation { display: flex; flex: none; gap: var(--ak-space-3); padding-inline: var(--ak-space-4); border-bottom: 1px solid var(--aibo-border); background: var(--aibo-surface); }
    .compact-region-navigation :global([aria-pressed='true']) { border-bottom: 2px solid var(--aibo-accent); border-radius: 0; }
    .workbench-chrome :global(.workspace-grid) { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: minmax(0, 1fr); }
    .workbench-chrome :global(.workspace-grid > .workspace-splitter) { display: none; }
    .workbench-chrome:not([data-layout='focus']):not([data-mobile-region='navigation']) :global(.workspace-grid > .sidebar),
    .workbench-chrome:not([data-layout='focus']):not([data-mobile-region='auxiliary']) :global(.workspace-grid > .inspector),
    .workbench-chrome:not([data-layout='focus']):not([data-mobile-region='content']) :global(.workspace-grid > :not(.sidebar):not(.inspector):not(.workspace-splitter)) { display: none; }
  }
</style>
