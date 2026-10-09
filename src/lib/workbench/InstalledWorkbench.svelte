<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import { Button, Card } from '$lib/ui-kit';
  import PresentationSurface from './PresentationSurface.svelte';
  import { installedWorkbenchPresentation, type InstalledWorkbenchState } from '../app/installed-workbench-controller';
  import type { ActionMessage } from '../presentation/contract';
  let { title, state, onAction, onReload, onToggleLayout, onToggleReading, onClose }: {
    title: string;
    state: InstalledWorkbenchState;
    onAction: (message: ActionMessage) => void;
    onReload: () => void;
    onToggleLayout: () => void;
    onToggleReading: () => void;
    onClose: () => void;
  } = $props();
  const view = $derived(installedWorkbenchPresentation(state, $locale));
</script>
<section class="installed-workbench" aria-label={title}>
  <div class="controls">
    <Button variant="outline" onclick={onToggleLayout}>{$t('workbench.changeLayout')}</Button>
    {#if view.snapshot?.view.kind === 'detail'}<Button variant="outline" onclick={onToggleReading}>{state.enhanced ? $t('workbench.genericReading') : $t('workbench.numberedReading')}</Button>{/if}
    <Button variant="ghost" onclick={onClose}>{$t('workbench.closePlugin')}</Button>
  </div>
  {#if view.snapshot}
    {#if view.error}<Card><p role="alert">{view.error}</p></Card>{/if}
    <PresentationSurface preference={state.enhanced ? undefined : null} snapshot={view.snapshot} layout={state.layout} focusTarget={state.focusTarget} {onAction} />
  {:else if view.error}
    <Card><p role="alert">{$t('workbench.toolUnavailable', {error: view.error})}</p><Button variant="outline" onclick={onReload}>{$t('workbench.reload')}</Button></Card>
  {:else}<Card><p role="status">{$t('workbench.loading')}</p></Card>{/if}
</section>
<style>
  .installed-workbench { display: flex; flex-direction: column; gap: 1rem; height: 100%; min-height: 0; overflow: auto; }
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
