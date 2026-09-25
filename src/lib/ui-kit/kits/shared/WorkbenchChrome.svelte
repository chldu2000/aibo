<script lang="ts">
  import type { UiWorkbenchChromeProps } from '../../contract';
  import Button from './Button.svelte';
  let { layout, children, auxiliaryOpen = true }: UiWorkbenchChromeProps = $props();
  let mobileRegion = $state<'navigation' | 'content' | 'auxiliary'>('content');
  $effect(() => { if (!auxiliaryOpen && mobileRegion === 'auxiliary') mobileRegion = 'content'; });
</script>
<div class="workbench-chrome" data-workbench data-layout={layout} data-mobile-region={mobileRegion}>
  <nav class="compact-region-navigation" aria-label="工作台区域">
    {#if layout !== 'focus'}<Button variant="ghost" aria-pressed={mobileRegion === 'navigation'} onclick={() => mobileRegion = 'navigation'}>工作区</Button>{/if}
    <Button variant="ghost" aria-pressed={mobileRegion === 'content' || layout === 'focus'} onclick={() => mobileRegion = 'content'}>会话</Button>
    {#if layout !== 'focus' && auxiliaryOpen}<Button variant="ghost" aria-pressed={mobileRegion === 'auxiliary'} onclick={() => mobileRegion = 'auxiliary'}>侧边栏</Button>{/if}
  </nav>
  {@render children()}
</div>
