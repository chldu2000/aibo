<script lang="ts">
  import { t, locale } from '$lib/i18n/runtime';
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { Badge, Button } from '$lib/ui-kit';
  import { diagnosticLogReason, type DiagnosticLogsState } from '$lib/app/diagnostic-logs-controller';
  let { state, desktop, onOpen }: { state: DiagnosticLogsState; desktop: boolean; onOpen: () => void } = $props();
</script>
<section class="settings-section" aria-labelledby="diagnostic-logs-title">
  <div class="settings-section-heading">
    <div><h2 id="diagnostic-logs-title">{$t('diagnostics.logs.title')}</h2><p>{$t('diagnostics.logs.description')}</p></div>
    {#if state.status}<Badge variant={state.status.state === 'degraded' ? 'warning' : 'outline'}>{$t(`diagnostics.logs.${state.status.state}`)}</Badge>{/if}
  </div>
  <div class="settings-section-body">
    {#if !desktop}<p role="status">{$t('diagnostics.preview')}</p>
    {:else}
      {#if state.status}
        <dl class="settings-runtime-list">
          <div><dt>{$t('diagnostics.logs.directory')}</dt><dd>{state.status.directory ?? $t('diagnostics.logs.initializing')}</dd></div>
          <div><dt>{$t('diagnostics.logs.dropped')}</dt><dd>{state.status.dropped}</dd></div>
        </dl>
        {#if state.status.error_code}<p role="status">{$t('diagnostics.logs.lastFailure', { reason: translateMessage($locale, diagnosticLogReason(state.status.error_code)) })}</p>{/if}
      {/if}
      {#if state.error}<p role="alert">{translateMessage($locale, state.error)}</p>{/if}
      <Button variant="outline" onclick={onOpen} disabled={state.opening || !state.status?.directory}>{$t('diagnostics.logs.open')}</Button>
    {/if}
  </div>
</section>

<style>
  .settings-runtime-list { min-width: 0; }
  .settings-runtime-list div { min-width: 0; gap: 16px; }
  .settings-runtime-list dd {
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
    overflow: visible;
  }
</style>
