<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import type { Snippet } from 'svelte';
  import { Badge, Button, Icon, Separator } from '$lib/ui-kit';
  import type { RuntimeDiagnostic } from '$lib/app/runtime-diagnostics';

  type DiagnosticsPanelProps = {
    presentationActions?: Snippet;
    open: boolean;
    embedded?: boolean;
    items: RuntimeDiagnostic[];
    checkedAt: number | null;
    loading: boolean;
    error: string;
    onOpenPlugin: (id: string) => void;
    desktop: boolean;
    workspaceCount: number;
    sessionCount: number;
    busy: boolean;
    onRefresh: () => void;
    onClose: () => void;
  };

  let {
    presentationActions,
    open,
    embedded = false,
    items, checkedAt, loading, error, onOpenPlugin,
    desktop,
    workspaceCount,
    sessionCount,
    busy,
    onRefresh,
    onClose,
  }: DiagnosticsPanelProps = $props();

  const attention = $derived(items.filter(item => item.status === 'attention'));
  const other = $derived(items.filter(item => item.status !== 'attention'));
  const time = (value: number) => new Date(value).toLocaleString($locale);
</script>

{#snippet diagnosticRow(item: RuntimeDiagnostic)}
  <div class="settings-row">
    <div class="settings-copy">
      <span class="settings-row-title">{item.label}</span>
      {#if item.providers.length}<span class="settings-row-meta">{$t('diagnostics.providers', { names: item.providers.join(', ') })}</span>{/if}
      {#each item.issues as issue}<span class="settings-row-meta">{issue}</span>{/each}
      <details>
        <summary>{$t('diagnostics.checkDetails')}</summary>
        <p class="settings-row-meta">{item.auth}</p>
        {#if item.authCheckedAt}<p class="settings-row-meta">{$t('diagnostics.authCheckedAt', { time: time(item.authCheckedAt) })}</p>{/if}
        <p class="settings-row-meta">{$t('diagnostics.connectionNotChecked')}</p>
      </details>
    </div>
    <Badge variant={item.status === 'attention' ? 'warning' : 'outline'}>{$t(`diagnostics.status.${item.status}`)}</Badge>
    <div class="settings-row-actions">
      <Button variant="ghost" size="icon" title={$t('diagnostics.openPlugin', { name: item.label })} aria-label={$t('diagnostics.openPlugin', { name: item.label })} onclick={() => onOpenPlugin(item.installationId)}><Icon name="settings" size={16} /></Button>
    </div>
  </div>
{/snippet}

{#if open}
  <div class:settings-content={!embedded}>
    <div id="diagnostics-panel-content" class="settings-tab-panel" role="tabpanel" aria-label={$t('diagnostics.runtimeStatus')}>
      {@render presentationActions?.()}
      <section class="settings-section" aria-labelledby="runtime-diagnostics-title" aria-busy={loading}>
        <div class="settings-section-heading">
          <div>
            <h2 id="runtime-diagnostics-title">{$t('diagnostics.overview')}</h2>
            <p>{$t('diagnostics.overviewDescription')}</p>
          </div>
          <div class="settings-row-actions">
            {#if desktop && checkedAt}<Badge variant={attention.length ? 'warning' : 'outline'}>{$t('diagnostics.attentionCount', { count: attention.length })}</Badge>{/if}
            {#if embedded}<Button variant="ghost" size="icon" type="button" onclick={onRefresh} disabled={busy} title={$t('diagnostics.refresh')} aria-label={$t('diagnostics.refresh')}><Icon name="refresh" size={16} /></Button>{/if}
          </div>
        </div>
        <div class="settings-section-body">
          {#if !desktop}<p role="status">{$t('diagnostics.preview')}</p>
          {:else}
            {#if loading}<p role="status">{$t('diagnostics.loading')}</p>{/if}
            {#if error}<p role="alert">{$t('diagnostics.refreshFailed', { error })}</p>{/if}
            {#if checkedAt}<p class="settings-row-meta">{$t('diagnostics.checkedAt', { time: time(checkedAt) })}</p>
            {:else if !loading && !error}<p role="status">{$t('diagnostics.notChecked')}</p>{/if}
            {#if checkedAt && !items.length}<p role="status">{$t('diagnostics.noPlugins')}</p>{/if}
            {#if attention.length}
              <div class="settings-rows">{#each attention as item (item.installationId)}{@render diagnosticRow(item)}{/each}</div>
            {:else if checkedAt && items.length && !error}
              <p role="status">{$t('diagnostics.noIssues')}</p>
            {/if}
            {#if other.length}
              <details>
                <summary>{$t('diagnostics.otherItems', { count: other.length })}</summary>
                <div class="settings-rows">{#each other as item (item.installationId)}{@render diagnosticRow(item)}{/each}</div>
              </details>
            {/if}
          {/if}
        </div>
      </section>
      <Separator />
      <section class="settings-section" aria-labelledby="runtime-info-title">
        <div class="settings-section-heading">
          <div><h2 id="runtime-info-title">{$t('diagnostics.environment')}</h2></div>
        </div>
        <dl class="settings-runtime-list settings-section-body">
          <div><dt>{$t('diagnostics.platform')}</dt><dd>{desktop ? 'macOS · Tauri' : $t('diagnostics.web')}</dd></div>
          <div><dt>{$t('scope.workspace')}</dt><dd>{workspaceCount}</dd></div>
          <div><dt>{$t('scope.session')}</dt><dd>{sessionCount}</dd></div>
        </dl>
      </section>
    </div>
  </div>

  {#if !embedded}
  <div class="settings-footer">
    <Button variant="outline" size="sm" type="button" onclick={onRefresh} disabled={busy}>
      <Icon name="refresh" size={13} /> {$t('diagnostics.refresh')}
    </Button>
    <Button size="sm" type="button" onclick={onClose}>{$t('common.done')}</Button>
  </div>
  {/if}
{/if}
