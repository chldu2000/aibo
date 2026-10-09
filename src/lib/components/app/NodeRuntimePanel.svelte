<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Button } from '$lib/ui-kit';
  import { nodeRuntimeIssueMessages, type NodeRuntimeState } from '$lib/app/node-runtime-controller';
  let { state, desktop, onDetect, onChoose, onAutomatic, onDownload }: {
    state: NodeRuntimeState; desktop: boolean;
    onDetect: () => void; onChoose: () => void; onAutomatic: () => void; onDownload: () => void;
  } = $props();
  const source = $derived({ system: $t('node.source.system'), manual: $t('node.source.manual'), managed: $t('node.source.managed') });
</script>
<section class="settings-section" aria-labelledby="node-runtime-title" aria-busy={state.pending !== null}>
  <div class="settings-section-heading"><div><h2 id="node-runtime-title">{$t('node.title')}</h2><p>{$t('node.description')}</p></div></div>
  {#if state.value?.selected}
    <p><strong>{source[state.value.selected.source]} · {state.value.selected.version}</strong></p>
    <p class="runtime-path">{state.value.selected.path}</p>
  {:else if state.value}<p role="status">{$t('node.unavailable')}</p>{/if}
  {#if state.value?.manualPath}<p class="runtime-path">{$t('node.manualPath', { path: state.value.manualPath })}</p>{/if}
  {#if state.value}
    <p>{$t('node.requirement', { version: state.value.hostRequirement })}</p>
    {#each nodeRuntimeIssueMessages(state.value) as issue}<p class="runtime-path">{translateMessage($locale, issue)}</p>{/each}
  {/if}
  <div class="runtime-buttons">
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null} onclick={onDetect}>{$t('node.detect')}</Button>
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null} onclick={onChoose}>{$t('node.choose')}</Button>
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null || !state.value?.downloadSupported} onclick={onDownload}>{$t('node.download', { version: state.value ? ` ${state.value.downloadVersion}` : '' })}</Button>
    {#if state.value?.manualPath || state.error}<Button variant="ghost" size="sm" disabled={!desktop || state.pending !== null} onclick={onAutomatic}>{$t('node.automatic')}</Button>{/if}
  </div>
  <p>{$t('node.managedDescription')}</p>
  {#if !desktop}<p>{$t('node.desktop')}</p>
  {:else if state.pending}<p role="status">{state.pending === 'download' ? $t('node.downloading') : state.pending === 'select' ? $t('node.selecting') : $t('node.detecting')}</p>{/if}
  {#if state.error}<p role="alert">{translateMessage($locale, state.error)}</p>{/if}
  {#if state.notice}<p role="status">{translateMessage($locale, state.notice)}</p>{/if}
</section>
<style>
  .runtime-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
  .runtime-path { overflow-wrap: anywhere; }
</style>
