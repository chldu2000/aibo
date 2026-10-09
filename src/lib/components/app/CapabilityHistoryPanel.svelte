<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '$lib/ui-kit';
  import { capabilityScopeKey, capabilityScopeLabel, type CapabilityHistoryState } from '$lib/app/capability-history-controller';
  import type { CapabilityHistoryScope, CapabilityHistorySource } from '$lib/types';
  let {state,desktop,onSource,onSelect,onReload,onMoreScopes,onRefresh,onOlder,onNewer,onLatest}: {
    state:CapabilityHistoryState;desktop:boolean;onSource?:(source:CapabilityHistorySource)=>void;onSelect:(scope:CapabilityHistoryScope)=>void;
    onReload:()=>void;onMoreScopes:()=>void;onRefresh:()=>void;onOlder:()=>void;onNewer:()=>void;onLatest:()=>void;
  }=$props();
  const text=(value:unknown)=>typeof value==='string'?value:$t('history.notRecorded');
</script>
<section aria-label={$t('history.capabilities')} data-ui-component="capability-history" aria-busy={state.loadingScopes||state.loadingEvents} class="capability-history">
  <nav aria-label={$t('history.capabilitySource')} class="history-heading"><Button variant="outline" disabled={!onSource||!desktop} aria-pressed={state.source!=='legacy'} onclick={()=>onSource?.('events')}>{$t('history.lifecycle')}</Button><Button variant="outline" disabled={!onSource||!desktop} aria-pressed={state.source==='legacy'} onclick={()=>onSource?.('legacy')}>{$t('history.legacy')}</Button></nav>
  {#if state.source==='legacy'}<p>{$t('history.legacyDescription')}</p>{/if}
  <p>{$t('history.capabilityDescription')}</p>
  {#if !desktop}<p role="status">{$t('history.capabilityDesktop')}</p>{/if}
  {#if state.error}<p role="alert">{translateMessage($locale, state.error)}</p>{/if}
  <div class="history-body">
    <nav aria-label={$t('history.capabilityScopes')} class="history-scopes">
      {#each state.scopes as item (capabilityScopeKey(item.scope))}
        <Button variant={state.selected&&capabilityScopeKey(state.selected)===capabilityScopeKey(item.scope)?'secondary':'ghost'} aria-pressed={!!state.selected&&capabilityScopeKey(state.selected)===capabilityScopeKey(item.scope)} onclick={()=>onSelect(item.scope)}>{capabilityScopeLabel(item, $locale)}</Button>
      {/each}
      {#if state.nextScopes}<Button variant="outline" disabled={state.loadingScopes} onclick={onMoreScopes}>{$t('history.moreScopes')}</Button>{/if}
      {#if desktop&&!state.loadingScopes&&!state.scopes.length&&!state.error}<p>{$t('history.noInvocations')}</p>{/if}
    </nav>
    <div class="history-events">
      <nav aria-label={$t('history.invocationPages')} class="history-heading">
        <Button variant="outline" disabled={!state.selected||state.loadingEvents} onclick={onRefresh}>{$t('history.refreshRecords')}</Button>
        <Button variant="outline" disabled={!state.selected} onclick={onLatest}>{$t('history.latestRecords')}</Button>
        <Button variant="outline" disabled={state.loadingEvents||state.pageNumber===1} onclick={onNewer}>{$t('history.newerRecords')}</Button>
        <span role="status">{$t('history.page', { page: state.pageNumber })}</span>
        <Button variant="outline" disabled={state.loadingEvents||!state.page?.nextBefore} onclick={onOlder}>{$t('history.olderRecords')}</Button>
      </nav>
      {#if state.loadingScopes||state.loadingEvents}<p role="status">{$t('history.loadingInvocations')}</p>{/if}
      {#each state.page?.events??[] as event (event.sequence)}
        <Card as="article" aria-label={$t('history.invocationLabel', { sequence: event.sequence })}>
          <CardHeader><CardTitle>{text(event.payload.capability)}</CardTitle><Badge variant="outline">{event.payload.type==='legacy_snapshot'?$t('history.legacy'):text(event.payload.type)} · {text(event.payload.status)}</Badge></CardHeader>
          <CardContent><p>{event.payload.type==='legacy_snapshot' ? $t('history.startedAt', { time: text(event.payload.startedAt) }) : text(event.payload.occurredAt)}{$t('history.invocationId', { id: text(event.payload.invocationId) })}</p>
            <details><summary>{$t('history.invocationDetails')}</summary><Textarea aria-label={$t('history.invocationDetailsLabel', { sequence: event.sequence })} value={JSON.stringify(event.payload,null,2)} readonly rows={8} /></details>
          </CardContent>
        </Card>
      {/each}
    </div>
  </div>
</section>
<style>
  .capability-history {display:flex;flex-direction:column;gap:12px;padding:16px;min-height:0;overflow:auto;}
  .history-heading {display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
  .history-body {display:grid;grid-template-columns:minmax(160px,260px) minmax(0,1fr);gap:16px;}
  .history-scopes,.history-events {display:flex;flex-direction:column;gap:8px;min-width:0;}
  @media(max-width:720px){.history-body{grid-template-columns:minmax(0,1fr);}}
</style>
