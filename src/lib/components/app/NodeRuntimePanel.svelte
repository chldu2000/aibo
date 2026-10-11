<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Badge, Button } from '$lib/ui-kit';
  import { nodeRuntimeIssueMessages, type NodeRuntimeState } from '$lib/app/node-runtime-controller';
  let { state, desktop, onDetect, onChoose, onAutomatic, onDownload }: {
    state: NodeRuntimeState; desktop: boolean;
    onDetect: () => void; onChoose: () => void; onAutomatic: () => void; onDownload: () => void;
  } = $props();
  const source = $derived({ system: $t('node.source.system'), manual: $t('node.source.manual'), managed: $t('node.source.managed') });
  const disabled = $derived(!desktop || state.pending !== null);
</script>
<section class="settings-section" aria-labelledby="node-runtime-title" aria-busy={state.pending !== null}>
  <div class="settings-section-heading"><div><h2 id="node-runtime-title">{$t('node.title')}</h2><p>{$t('node.description')}</p></div></div>
  <div class="settings-section-body">
    <div class="settings-rows">
      {#if state.value}
        <div class="settings-row">
          <div class="settings-copy">
            {#if state.value.selected}
              <span class="settings-row-title">{source[state.value.selected.source]} · {state.value.selected.version}</span>
              <span class="settings-row-meta runtime-path">{state.value.selected.path}</span>
            {:else}
              <span class="settings-row-title" role="status">{$t('node.unavailable')}</span>
            {/if}
            {#if state.value.manualPath}<span class="settings-row-meta runtime-path">{$t('node.manualPath', { path: state.value.manualPath })}</span>{/if}
            <span class="settings-row-meta">{$t('node.requirement', { version: state.value.hostRequirement })}</span>
            {#each nodeRuntimeIssueMessages(state.value) as issue}<span class="settings-row-meta runtime-path">{translateMessage($locale, issue)}</span>{/each}
          </div>
          <div class="settings-row-actions">
            <Badge variant={state.value.selected ? 'success' : 'destructive'}>{state.value.selected ? $t('node.available') : $t('node.missing')}</Badge>
            <Button variant="ghost" size="sm" {disabled} onclick={onDetect}>{$t('node.detect')}</Button>
          </div>
        </div>
      {/if}
      <div class="settings-row">
        <div class="settings-copy">
          <span class="settings-row-title">{$t('node.change')}</span>
          <span class="settings-row-meta">{$t('node.managedDescription')}</span>
        </div>
        <div class="settings-row-actions">
          {#if !state.value}<Button variant="ghost" size="sm" {disabled} onclick={onDetect}>{$t('node.detect')}</Button>{/if}
          {#if state.value?.manualPath || state.error}<Button variant="ghost" size="sm" {disabled} onclick={onAutomatic}>{$t('node.automatic')}</Button>{/if}
          <Button variant="outline" size="sm" {disabled} onclick={onChoose}>{$t('node.choose')}</Button>
          <Button variant="outline" size="sm" disabled={disabled || !state.value?.downloadSupported} onclick={onDownload}>{$t('node.download', { version: state.value ? ` ${state.value.downloadVersion}` : '' })}</Button>
        </div>
      </div>
    </div>
    {#if !desktop}<p>{$t('node.desktop')}</p>
    {:else if state.pending}<p role="status">{state.pending === 'download' ? $t('node.downloading') : state.pending === 'select' ? $t('node.selecting') : $t('node.detecting')}</p>{/if}
    {#if state.error}<p role="alert">{translateMessage($locale, state.error)}</p>{/if}
    {#if state.notice}<p role="status">{translateMessage($locale, state.notice)}</p>{/if}
  </div>
</section>
<style>
  .runtime-path { overflow-wrap: anywhere; }
</style>
