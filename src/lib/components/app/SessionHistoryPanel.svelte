<script lang="ts">
  import { onMount } from 'svelte';
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
  const roleLabel: Record<string,string> = {user:'用户',assistant:'助手',system:'系统',tool:'工具'};
  onMount(()=>heading?.focus());
</script>
<section aria-labelledby="session-history-heading" class="session-history" data-ui-component="session-history">
  <div class="history-heading">
    <h2 id="session-history-heading" tabindex="-1" bind:this={heading}>会话历史</h2>
    <Button variant="outline" disabled={!desktop || !workspaceId || history.loading} onclick={onReload}>刷新会话列表</Button>
    <Button variant="ghost" onclick={onClose}>返回工作台</Button>
  </div>
  <nav aria-label="会话历史工作区" class="history-navigation">
    {#each workspaces as workspace (workspace.id)}<Button variant={workspace.id===workspaceId?'secondary':'ghost'} aria-pressed={workspace.id===workspaceId} onclick={()=>onWorkspace(workspace.id)}>{workspace.label}</Button>{/each}
  </nav>
  <p>此处显示宿主保存的消息，可能包含多个会话分支。列表包括已归档会话。</p>
  {#if !desktop}<p role="status">会话历史需要桌面宿主。</p>
  {:else if !workspaceId}<p role="status">请先添加工作区。</p>{/if}
  {#if history.error}<p role="alert">{history.error}</p>{/if}
  <div class="history-body">
    <nav aria-label="历史会话" class="history-sessions">
      <Input aria-label="搜索历史会话" placeholder="搜索会话名称或 Agent" value={search} oninput={(event)=>{search=event.currentTarget.value;}} />
      {#each sessions as session (session.id)}
        <Button variant={session.id===history.selectedId?'secondary':'ghost'} aria-pressed={session.id===history.selectedId} onclick={()=>onSession(session.id)}>{session.label}{session.archived?'（已归档）':''}</Button>
      {/each}
      {#if desktop && workspaceId && !history.loading && !sessions.length}<p>没有匹配的会话。</p>{/if}
    </nav>
    <div class="history-messages">
      <nav aria-label="会话消息翻页" class="history-navigation">
        <Button variant="outline" disabled={!history.selectedId || history.loading} onclick={onRefresh}>刷新记录</Button>
        <Button variant="outline" disabled={!history.selectedId} onclick={onLatest}>最新消息</Button>
        <Button variant="outline" disabled={history.loading || history.pageNumber===1} onclick={onNewer}>较新消息</Button>
        <span role="status">第 {history.pageNumber} 页</span>
        <Button variant="outline" disabled={history.loading || !history.page?.nextBefore} onclick={onOlder}>更早消息</Button>
      </nav>
      {#if history.loading}<p role="status">正在读取已保存的历史…</p>{/if}
      {#if history.page}
        <h3>{history.page.session.label}</h3>
        {#if !history.page.items.length}<p>此会话尚无宿主保存的消息。</p>{/if}
        {#each history.page.items as item (item.id)}
          <Card as="article" aria-label={`${roleLabel[item.role]??item.role}消息`}>
            <CardHeader><CardTitle>{roleLabel[item.role]??item.role}{item.toolName?` · ${item.toolName}`:''}</CardTitle><Badge variant="outline">{item.status}</Badge></CardHeader>
            <CardContent>
              <p><time datetime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>{#if item.turnId} · 回合 {item.turnId}{/if}</p>
              <Textarea aria-label={`${roleLabel[item.role]??item.role}消息内容`} value={item.content} readonly rows={6} />
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
