<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '$lib/ui-kit';
  import { capabilityScopeKey, capabilityScopeLabel, type CapabilityHistoryState } from '$lib/app/capability-history-controller';
  import type { CapabilityHistoryScope, CapabilityHistorySource } from '$lib/types';
  let {state,desktop,onSource,onSelect,onReload,onMoreScopes,onRefresh,onOlder,onNewer,onLatest,onBack}: {
    state:CapabilityHistoryState;desktop:boolean;onSource?:(source:CapabilityHistorySource)=>void;onSelect:(scope:CapabilityHistoryScope)=>void;
    onReload:()=>void;onMoreScopes:()=>void;onRefresh:()=>void;onOlder:()=>void;onNewer:()=>void;onLatest:()=>void;onBack:()=>void;
  }=$props();
  let heading:HTMLHeadingElement;
  onMount(()=>heading?.focus());
  const text=(value:unknown)=>typeof value==='string'?value:'未记录';
</script>
<section aria-labelledby="capability-history-heading" data-ui-component="capability-history" aria-busy={state.loadingScopes||state.loadingEvents} class="capability-history">
  <div class="history-heading"><h2 id="capability-history-heading" tabindex="-1" bind:this={heading}>插件调用历史</h2>
    <Button variant="outline" disabled={!desktop||state.loadingScopes} onclick={onReload}>刷新作用域</Button>
    <Button variant="ghost" onclick={onBack}>返回执行历史</Button>
  </div>
  <nav aria-label="调用历史来源" class="history-heading"><Button variant="outline" disabled={!onSource||!desktop} aria-pressed={state.source!=='legacy'} onclick={()=>onSource?.('events')}>生命周期记录</Button><Button variant="outline" disabled={!onSource||!desktop} aria-pressed={state.source==='legacy'} onclick={()=>onSource?.('legacy')}>旧调用快照</Button></nav>
  {#if state.source==='legacy'}<p>旧版本只保存了调用状态，无法还原完整生命周期；此处显示升级时保留的快照。</p>{/if}
  <p>记录按当前窗口隔离，可核对调用链与绑定版本。插件停用或原作用域删除后仍可读取。</p>
  {#if !desktop}<p role="status">插件调用历史需要桌面宿主。</p>{/if}
  {#if state.error}<p role="alert">{state.error}</p>{/if}
  <div class="history-body">
    <nav aria-label="调用历史作用域" class="history-scopes">
      {#each state.scopes as item (capabilityScopeKey(item.scope))}
        <Button variant={state.selected&&capabilityScopeKey(state.selected)===capabilityScopeKey(item.scope)?'secondary':'ghost'} aria-pressed={!!state.selected&&capabilityScopeKey(state.selected)===capabilityScopeKey(item.scope)} onclick={()=>onSelect(item.scope)}>{capabilityScopeLabel(item)}</Button>
      {/each}
      {#if state.nextScopes}<Button variant="outline" disabled={state.loadingScopes} onclick={onMoreScopes}>更多作用域</Button>{/if}
      {#if desktop&&!state.loadingScopes&&!state.scopes.length&&!state.error}<p>当前窗口暂无此类调用记录。</p>{/if}
    </nav>
    <div class="history-events">
      <nav aria-label="调用记录翻页" class="history-heading">
        <Button variant="outline" disabled={!state.selected||state.loadingEvents} onclick={onRefresh}>刷新记录</Button>
        <Button variant="outline" disabled={!state.selected} onclick={onLatest}>最新记录</Button>
        <Button variant="outline" disabled={state.loadingEvents||state.pageNumber===1} onclick={onNewer}>较新记录</Button>
        <span role="status">第 {state.pageNumber} 页</span>
        <Button variant="outline" disabled={state.loadingEvents||!state.page?.nextBefore} onclick={onOlder}>更早记录</Button>
      </nav>
      {#if state.loadingScopes||state.loadingEvents}<p role="status">正在读取调用历史…</p>{/if}
      {#each state.page?.events??[] as event (event.sequence)}
        <Card as="article" aria-label={`调用记录 ${event.sequence}`}>
          <CardHeader><CardTitle>{text(event.payload.capability)}</CardTitle><Badge variant="outline">{event.payload.type==='legacy_snapshot'?'旧调用快照':text(event.payload.type)} · {text(event.payload.status)}</Badge></CardHeader>
          <CardContent><p>{event.payload.type==='legacy_snapshot' ? `开始时间 ${text(event.payload.startedAt)}` : text(event.payload.occurredAt)} · 调用 {text(event.payload.invocationId)}</p>
            <Textarea aria-label={`调用记录 ${event.sequence}详情`} value={JSON.stringify(event.payload,null,2)} readonly rows={8} />
          </CardContent>
        </Card>
      {/each}
    </div>
  </div>
</section>
<style>
  .capability-history {display:flex;flex-direction:column;gap:12px;padding:16px;min-height:0;overflow:auto;}
  .history-heading {display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
  .history-heading h2 {flex:1;}
  .history-body {display:grid;grid-template-columns:minmax(160px,260px) minmax(0,1fr);gap:16px;}
  .history-scopes,.history-events {display:flex;flex-direction:column;gap:8px;min-width:0;}
  @media(max-width:720px){.history-body{grid-template-columns:minmax(0,1fr);}}
</style>
