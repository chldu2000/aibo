<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import { sessionStateLabel } from './session-utils';
  import { flattenPiTree } from './inspector-utils';
  import type {
    CodexThreadListItem,
    SessionPanelView,
    WorkspaceListItem,
  } from './view-types';
  import type { PiSessionTreeSnapshot, SessionExecutionProfile } from '$lib/types';

  type InspectorProps = {
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    desktop: boolean;
    codexThreads: CodexThreadListItem[];
    piTree: PiSessionTreeSnapshot | null;
    executionProfile: SessionExecutionProfile | null;
    threadBusy: boolean;
    busy: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    onSyncCodexThreads: () => void;
    onRequestPiTreeNavigation: (entryId: string) => void;
    onRefreshPiTree: (sessionId: string) => void;
    onRefresh: () => void;
  };

  let {
    workspace,
    session,
    desktop,
    codexThreads,
    piTree,
    executionProfile,
    threadBusy,
    busy,
    sessionRunning,
    selectedSessionArchiving,
    onSyncCodexThreads,
    onRequestPiTreeNavigation,
    onRefreshPiTree,
    onRefresh,
  }: InspectorProps = $props();

  function modeLabel(mode: string): string {
    return mode === 'plan' ? '计划' : mode === 'edit' ? '编辑' : '问答';
  }

  function filesystemLabel(policy: string): string {
    return policy === 'workspace-write' ? '工作区可写' : '只读';
  }

  function commandLabel(policy: string): string {
    return policy === 'trusted' ? '自动执行' : policy === 'approved' ? '需审批' : '禁用';
  }
</script>

<Card as="aside" class="inspector" data-ui-component="inspector" aria-label="会话上下文">
  <CardHeader class="panel-heading">
    <CardTitle>上下文</CardTitle>
    {#if session}
      <Badge variant={session.archived ? 'secondary' : sessionRunning || selectedSessionArchiving ? 'warning' : 'outline'}>
        {selectedSessionArchiving ? '归档中' : sessionStateLabel(session)}
      </Badge>
    {:else}
      <Badge variant="secondary">未选择</Badge>
    {/if}
  </CardHeader>
  <Separator />

  {#if session}
    <Card class="session-context-card">
      <CardHeader class="session-context-heading">
        <div class="session-context-title">
          <span class={`session-agent session-agent-${session.agent}`}>{session.agent === 'pi' ? 'PI' : 'CX'}</span>
          <div>
            <CardTitle>{session.label}</CardTitle>
            <small>{session.agent === 'pi' ? 'Pi SDK host' : 'Codex app-server'}</small>
          </div>
        </div>
      </CardHeader>
      <CardContent class="session-context-content">
        <dl>
          <div><dt>会话 ID</dt><dd title={session.id}>{session.id}</dd></div>
          {#if session.externalSessionId}<div><dt>远端绑定</dt><dd title={session.externalSessionId}>{session.externalSessionId}</dd></div>{/if}
          <div><dt>更新时间</dt><dd>{session.updatedAt}</dd></div>
        </dl>
      </CardContent>
    </Card>
    {#if executionProfile}
      <Card class="profile-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>执行配置</CardTitle>
          <Badge variant={executionProfile.nativeSandbox ? 'success' : 'warning'}>
            {executionProfile.nativeSandbox ? '原生沙箱' : '无原生沙箱'}
          </Badge>
        </CardHeader>
        <CardContent class="profile-card-content">
          <dl>
            <div><dt>模式</dt><dd>{modeLabel(executionProfile.enforced.interactionMode)}</dd></div>
            <div><dt>文件</dt><dd>{filesystemLabel(executionProfile.enforced.filesystemPolicy)}</dd></div>
            <div><dt>命令</dt><dd>{commandLabel(executionProfile.enforced.commandPolicy)}</dd></div>
            <div><dt>审批</dt><dd>{executionProfile.enforced.approvalPolicy}</dd></div>
          </dl>
          {#if executionProfile.unsupported.length > 0}
            <p class="profile-warning">未启用：{executionProfile.unsupported.join('、')}</p>
          {/if}
        </CardContent>
      </Card>
    {/if}
  {:else}
    <div class="inspector-empty">从左侧选择一个会话查看上下文。</div>
  {/if}

  {#if workspace && desktop}
    <Card class="thread-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>Codex 线程</CardTitle>
        <Badge variant="secondary" class="count-pill">{codexThreads.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if codexThreads.length === 0}
          <p class="thread-empty">暂无远端线程</p>
        {:else}
          <div class="thread-list" aria-label="Codex 线程列表">
            {#each codexThreads.slice(0, 5) as thread (thread.id)}
              <div class="thread-item">
                <div class="thread-copy">
                  <strong>{thread.title ?? thread.id}</strong>
                  <small>{thread.cwd ?? '当前工作区'}{thread.updatedAt ? ` · ${thread.updatedAt}` : ''}</small>
                </div>
                <Badge variant="outline">{thread.status ?? 'unknown'}</Badge>
              </div>
            {/each}
          </div>
          {#if codexThreads.length > 5}<small class="thread-more">仅显示最近 5 个线程</small>{/if}
        {/if}
        <Button variant="ghost" size="sm" type="button" onclick={onSyncCodexThreads} disabled={threadBusy || busy}>
          <Icon name="refresh" size={13} /> 刷新线程
        </Button>
      </CardContent>
    </Card>
  {/if}

  {#if session?.agent === 'pi' && desktop && piTree}
    <Card class="thread-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>Pi 会话树</CardTitle>
        <Badge variant="secondary" class="count-pill">{flattenPiTree(piTree.tree).length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if piTree.tree.length === 0}
          <p class="thread-empty">首条消息后生成会话树</p>
        {:else}
          <div class="thread-list" aria-label="Pi 会话树">
            {#each flattenPiTree(piTree.tree) as entry (entry.node.id)}
              <div class="thread-item" style={`padding-left: ${entry.depth * 14}px`}>
                <div class="thread-copy">
                  <strong>{entry.node.label ?? entry.node.summary ?? entry.node.type}</strong>
                  <small>{entry.node.role ?? entry.node.type}{entry.node.id === piTree.leafId ? ' · 当前分支' : ''}</small>
                </div>
                {#if entry.node.id !== piTree.leafId}
                  <Button variant="ghost" size="sm" type="button" onclick={() => onRequestPiTreeNavigation(entry.node.id)} disabled={busy || sessionRunning || selectedSessionArchiving}>切换</Button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <Button variant="ghost" size="sm" type="button" onclick={() => onRefreshPiTree(session.id)} disabled={busy || selectedSessionArchiving}>
          <Icon name="refresh" size={13} /> 刷新会话树
        </Button>
      </CardContent>
    </Card>
  {/if}

  {#if workspace}
    <Card class="trust-card">
      <div class="trust-card-heading"><Icon name="trust" size={16} /><strong>工作区信任</strong></div>
      <p>{workspace.trust === 'trusted' ? '当前目录已允许 Agent 操作。' : '确认目录来源后再启用 Agent 操作。'}</p>
    </Card>
  {/if}

  <Separator />
  <div class="inspector-footer">
    <Button variant="ghost" size="sm" type="button" onclick={onRefresh} disabled={busy}>
      <Icon name="refresh" size={13} /> 刷新数据
    </Button>
  </div>
</Card>
