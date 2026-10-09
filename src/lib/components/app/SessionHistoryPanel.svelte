<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { formatDateTime } from '../../../../packages/i18n/index.js';
  import { onMount, tick } from 'svelte';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '$lib/ui-kit';
  import type { SessionHistoryState } from '$lib/app/session-history-controller';
  let { workspaces, workspaceId, state: history, desktop, onWorkspace, onSession, onRefresh, onOlder, onNewer, onLatest, onClose, onReload }: {
    workspaces: {id:string;label:string}[]; workspaceId:string|null; state:SessionHistoryState; desktop:boolean;
    onWorkspace:(id:string)=>void; onSession:(id:string)=>void; onRefresh:()=>void;
    onOlder:()=>void; onNewer:()=>void; onLatest:()=>void; onClose:()=>void; onReload:()=>void;
  } = $props();
  let heading: HTMLHeadingElement;
  let search = $state('');
  const sessions = $derived(history.sessions.filter(session => `${session.label} ${session.agent}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const roleLabel: Record<string,string> = $derived({user:$t('role.user'),assistant:$t('role.assistant'),system:$t('role.system'),tool:$t('role.tool')});
  const statusLabel: Record<string,string> = $derived({streaming:$t('history.status.streaming'),completed:$t('history.status.completed'),failed:$t('history.status.failed'),queued:$t('history.status.queued'),interrupted:$t('history.status.interrupted')});
  onMount(()=>heading?.focus());
  $effect(() => {
    const target = history.targetMessageId;
    if (!target || history.loading || !history.page?.items.some(item => item.id === target)) return;
    void tick().then(() => document.getElementById(`history-message-${target}`)?.scrollIntoView({ block: 'center' }));
  });
</script>
<section aria-labelledby="session-history-heading" class="session-history" data-ui-component="session-history">
  <div class="history-heading">
    <h2 id="session-history-heading" tabindex="-1" bind:this={heading}>{$t('history.sessions')}</h2>
    <Button variant="outline" disabled={!desktop || !workspaceId || history.loading} onclick={onReload}>{$t('history.reloadSessions')}</Button>
    <Button variant="ghost" onclick={onClose}>{$t('history.backToWorkbench')}</Button>
  </div>
  <nav aria-label={$t('history.sessionWorkspaces')} class="history-navigation">
    {#each workspaces as workspace (workspace.id)}<Button variant={workspace.id===workspaceId?'secondary':'ghost'} aria-pressed={workspace.id===workspaceId} onclick={()=>onWorkspace(workspace.id)}>{workspace.label}</Button>{/each}
  </nav>
  <p>{$t('history.sessionDescription')}</p>
  {#if !desktop}<p role="status">{$t('history.sessionDesktop')}</p>
  {:else if !workspaceId}<p role="status">{$t('history.addWorkspace')}</p>{/if}
  {#if history.error}<p role="alert">{translateMessage($locale, history.error)}</p>{/if}
  <div class="history-body">
    <nav aria-label={$t('history.sessionList')} class="history-sessions">
      <Input aria-label={$t('history.searchSessions')} placeholder={$t('history.searchPlaceholder')} value={search} oninput={(event)=>{search=event.currentTarget.value;}} />
      {#each sessions as session (session.id)}
        <Button variant={session.id===history.selectedId?'secondary':'ghost'} aria-pressed={session.id===history.selectedId} onclick={()=>onSession(session.id)}>{session.label}{session.archived?$t('history.archivedSuffix'):''}</Button>
      {/each}
      {#if desktop && workspaceId && !history.loading && !sessions.length}<p>{$t('history.noMatchingSessions')}</p>{/if}
    </nav>
    <div class="history-messages">
      <nav aria-label={$t('history.messagePages')} class="history-navigation">
        <Button variant="outline" disabled={!history.selectedId || history.loading} onclick={onRefresh}>{$t('history.refreshRecords')}</Button>
        <Button variant="outline" disabled={!history.selectedId} onclick={onLatest}>{$t('history.latestMessages')}</Button>
        <Button variant="outline" disabled={history.loading || history.pageNumber===1} onclick={onNewer}>{$t('history.newerMessages')}</Button>
        <span role="status">{$t('history.page', { page: history.pageNumber })}</span>
        <Button variant="outline" disabled={history.loading || !history.page?.nextBefore} onclick={onOlder}>{$t('history.olderMessages')}</Button>
      </nav>
      {#if history.loading}<p role="status">{$t('history.loadingMessages')}</p>{/if}
      {#if history.page}
        <h3>{history.page.session.label}</h3>
        {#if !history.page.items.length}<p>{$t('history.noMessages')}</p>{/if}
        {#each history.page.items as item (item.id)}
          <Card as="article" id={`history-message-${item.id}`} data-search-hit={history.targetMessageId === item.id ? 'true' : undefined} aria-label={$t('history.messageLabel', { role: roleLabel[item.role] ?? item.role })}>
            <CardHeader><CardTitle>{roleLabel[item.role]??item.role}{item.toolName?` · ${item.toolName}`:''}</CardTitle><Badge variant="outline">{Object.hasOwn(statusLabel,item.status)?statusLabel[item.status]:item.status}</Badge></CardHeader>
            <CardContent>
              <p><time datetime={item.createdAt}>{formatDateTime($locale, item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>{#if item.turnId}{$t('history.turn', { turn: item.turnId })}{/if}</p>
              <Textarea aria-label={$t('history.messageContentLabel', { role: roleLabel[item.role] ?? item.role })} value={item.content} readonly rows={6} />
            </CardContent>
          </Card>
        {/each}
      {/if}
    </div>
  </div>
</section>
<style>
  .session-history { display:flex; flex-direction:column; gap:12px; padding:16px; min-height:0; overflow:auto; }
  .history-heading, .history-navigation { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .history-heading h2 { flex:1; }
  .history-body { display:grid; grid-template-columns:minmax(160px, 240px) minmax(0,1fr); gap:16px; }
  .history-sessions, .history-messages { display:flex; flex-direction:column; gap:8px; min-width:0; }
  @media (max-width:720px) { .history-body { grid-template-columns:minmax(0,1fr); } }
</style>
