<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import { sessionStateLabel } from './session-utils';
  import { flattenPiTree } from './inspector-utils';
  import type {
    CodexThreadListItem,
    SessionPanelView,
    WorkspaceListItem,
  } from './view-types';
  import type { GitFileAction, PiSessionTreeSnapshot, SessionExecutionProfile, TurnChangeSet, TurnFileDiff, WorkspaceChanges } from '$lib/types';

  type InspectorProps = {
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    desktop: boolean;
    codexThreads: CodexThreadListItem[];
    piTree: PiSessionTreeSnapshot | null;
    executionProfile: SessionExecutionProfile | null;
    turnChangeSet: TurnChangeSet | null;
    workspaceChanges: WorkspaceChanges | null;
    turnFileDiff: TurnFileDiff | null;
    threadBusy: boolean;
    busy: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    onSyncCodexThreads: () => void;
    onRequestPiTreeNavigation: (entryId: string) => void;
    onRefreshPiTree: (sessionId: string) => void;
    onRestoreTurnChangeSet: (sessionId: string, turnId: string) => void;
    onShowTurnFileDiff: (sessionId: string, turnId: string, path: string) => void;
    onApplyGitFileAction: (sessionId: string, path: string, action: GitFileAction) => void;
    onRefresh: () => void;
  };

  let {
    workspace,
    session,
    desktop,
    codexThreads,
    piTree,
    executionProfile,
    turnChangeSet,
    workspaceChanges,
    turnFileDiff,
    threadBusy,
    busy,
    sessionRunning,
    selectedSessionArchiving,
    onSyncCodexThreads,
    onRequestPiTreeNavigation,
    onRefreshPiTree,
    onRestoreTurnChangeSet,
    onShowTurnFileDiff,
    onApplyGitFileAction,
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
    {#if turnChangeSet}
      <Card class="changeset-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>本轮变更</CardTitle>
          <Badge variant={turnChangeSet.files.length > 0 ? 'warning' : 'secondary'}>
            {turnChangeSet.files.length} 个文件
          </Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <small class="changeset-status">{turnChangeSet.captureStatus === 'captured' ? '已采集' : turnChangeSet.captureStatus === 'partial' ? '部分采集' : '采集失败'} · {turnChangeSet.attribution}</small>
          {#if turnChangeSet.commands.length > 0}
            <small class="changeset-status">命令 · {turnChangeSet.commands.length} 项</small>
            <div class="thread-list" aria-label="本轮命令">
              {#each turnChangeSet.commands.slice(0, 5) as command (command.id)}
                <div class="thread-item changeset-file">
                  <span class={`change-kind ${command.status === 'failed' ? 'change-kind-deleted' : 'change-kind-modified'}`}>{command.status === 'failed' ? '!' : '>'}</span>
                  <div class="thread-copy">
                    <code title={command.command ?? command.output}>{command.command || command.output || command.toolName || '命令'}</code>
                    <small>{command.cwd ?? '当前工作区'}{command.exitCode === null ? '' : ` · 退出码 ${command.exitCode}`}</small>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if turnChangeSet.verification.length > 0}
            <small class="changeset-status">验证 · {turnChangeSet.verification.filter((item) => item.status === 'passed').length}/{turnChangeSet.verification.length} 通过</small>
          {/if}
          {#if turnChangeSet.files.length > 0}
            <div class="thread-list" aria-label="本轮文件变更">
              {#each turnChangeSet.files.slice(0, 8) as file (file.path)}
                <div class="thread-item changeset-file changeset-file-row">
                  <Button variant="ghost" size="sm" type="button" class="changeset-file-button" onclick={() => onShowTurnFileDiff(turnChangeSet.sessionId, turnChangeSet.turnId, file.path)} disabled={busy || sessionRunning || selectedSessionArchiving} title="查看文件 diff">
                    <span class={`change-kind change-kind-${file.kind}`}>{file.kind === 'added' ? '+' : file.kind === 'deleted' ? '−' : '~'}</span>
                    <code title={file.path}>{file.path}</code>
                  </Button>
                  {#if workspaceChanges?.captureStatus === 'captured'}
                    <div class="changeset-actions">
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, file.path, 'stage')} disabled={busy || sessionRunning || selectedSessionArchiving} title="暂存">暂存</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, file.path, 'unstage')} disabled={busy || sessionRunning || selectedSessionArchiving} title="取消暂存">撤销暂存</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, file.path, 'revert')} disabled={busy || sessionRunning || selectedSessionArchiving} title="撤销文件变更">还原</Button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {#if turnChangeSet.files.length > 8}<small class="thread-more">还有 {turnChangeSet.files.length - 8} 个文件</small>{/if}
          {:else}
            <p class="thread-empty">本轮没有检测到文件变化</p>
          {/if}
          {#if turnChangeSet.captureError}<p class="profile-warning">{turnChangeSet.captureError}</p>{/if}
          {#if turnFileDiff}
            <div class="turn-file-diff">
              <small>{turnFileDiff.path}</small>
              {#if turnFileDiff.available}
                <pre>{turnFileDiff.diff || '没有可显示的 diff'}</pre>
              {:else}
                <p class="thread-empty">{turnFileDiff.reason}</p>
              {/if}
            </div>
          {/if}
          {#if turnChangeSet.files.length > 0}
            <Button variant="outline" size="sm" type="button" onclick={() => onRestoreTurnChangeSet(turnChangeSet.sessionId, turnChangeSet.turnId)} disabled={busy || sessionRunning || selectedSessionArchiving || turnChangeSet.attribution !== 'agent'}>
              <Icon name="undo" size={13} /> 恢复本轮变更
            </Button>
          {/if}
        </CardContent>
      </Card>
    {/if}
    {#if workspaceChanges}
      <Card class="changeset-card workspace-changes-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>整个工作区</CardTitle>
          <Badge variant={workspaceChanges.captureStatus === 'captured' && workspaceChanges.dirty ? 'warning' : 'secondary'}>
            {workspaceChanges.captureStatus === 'captured' ? `${workspaceChanges.files.length} 项` : '不可用'}
          </Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          {#if workspaceChanges.captureError}
            <p class="thread-empty">{workspaceChanges.captureError}</p>
          {:else if workspaceChanges.files.length > 0}
            <div class="thread-list" aria-label="整个工作区文件变更">
              {#each workspaceChanges.files.slice(0, 8) as file (file.path)}
                <div class="thread-item changeset-file">
                  <span class={`change-kind change-kind-${file.kind}`}>{file.kind === 'added' ? '+' : file.kind === 'deleted' ? '−' : file.kind === 'renamed' ? '↪' : '~'}</span>
                  <code title={file.path}>{file.path}</code>
                </div>
              {/each}
            </div>
            {#if workspaceChanges.files.length > 8}<small class="thread-more">还有 {workspaceChanges.files.length - 8} 项</small>{/if}
          {:else}
            <p class="thread-empty">工作区干净</p>
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
