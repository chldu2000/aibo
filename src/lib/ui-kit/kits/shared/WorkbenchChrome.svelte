<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import type { UiWorkbenchChromeProps } from '../../contract';
  import Button from './Button.svelte';
  let { layout, children, auxiliaryOpen = true }: UiWorkbenchChromeProps = $props();
  let mobileRegion = $state<'navigation' | 'content' | 'auxiliary'>('content');
  $effect(() => { if (!auxiliaryOpen && mobileRegion === 'auxiliary') mobileRegion = 'content'; });
</script>
<div class="workbench-chrome" data-workbench data-layout={layout} data-mobile-region={mobileRegion}>
  <nav class="compact-region-navigation" aria-label={$t('workbench.regions')}>
    {#if layout !== 'focus'}<Button variant="ghost" aria-pressed={mobileRegion === 'navigation'} onclick={() => mobileRegion = 'navigation'}>{$t('scope.workspace')}</Button>{/if}
    <Button variant="ghost" aria-pressed={mobileRegion === 'content' || layout === 'focus'} onclick={() => mobileRegion = 'content'}>{$t('scope.session')}</Button>
    {#if layout !== 'focus' && auxiliaryOpen}<Button variant="ghost" aria-pressed={mobileRegion === 'auxiliary'} onclick={() => mobileRegion = 'auxiliary'}>{$t('window.sidebar')}</Button>{/if}
  </nav>
  {@render children()}
</div>
