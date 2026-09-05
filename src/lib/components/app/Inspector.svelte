<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import ProjectActionsPanel from './ProjectActionsPanel.svelte';
  import { sessionStateLabel } from './session-utils';
  import { flattenPiTree } from './inspector-utils';
  import type {
    AgentDiagnostic,
    CodexThreadListItem,
    SessionPanelView,
    WorkspaceListItem,
  } from './view-types';
  import type { Artifact, ArtifactContent, CheckpointFile, ContextAttachment, GitFileAction, PiSessionTreeSnapshot, ProjectAction, ProjectActionKind, ProjectActionRun, RestoreOperation, SessionExecutionProfile, TurnChangeSet, TurnFileDiff, WorkspaceCapabilityInventory, WorkspaceChanges } from '$lib/types';

  type InspectorProps = {
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    desktop: boolean;
    diagnostics: AgentDiagnostic[];
    workspaceCapabilities: WorkspaceCapabilityInventory | null;
    codexThreads: CodexThreadListItem[];
    piTree: PiSessionTreeSnapshot | null;
    executionProfile: SessionExecutionProfile | null;
    attachments: ContextAttachment[];
    artifacts: Artifact[];
    projectActions: ProjectAction[];
    projectActionRuns: ProjectActionRun[];
    turnChangeSet: TurnChangeSet | null;
    checkpoints: CheckpointFile[];
    restoreOperations: RestoreOperation[];
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
    onApplyGitFileAction: (sessionId: string, turnId: string, path: string, action: GitFileAction) => void;
    onApplyGitHunkAction: (sessionId: string, turnId: string, path: string, hunkIndex: number, action: GitFileAction) => void;
    onReadArtifact: (sessionId: string, artifactId: string) => Promise<ArtifactContent>;
    onSaveProjectAction: (input: { workspaceId: string; actionId?: string | null; name: string; kind: ProjectActionKind; program: string; args: string[]; cwd?: string | null; enabled?: boolean }) => Promise<void>;
    onDeleteProjectAction: (actionId: string) => Promise<void>;
    onRunProjectAction: (actionId: string) => Promise<void>;
    onRefresh: () => void;
  };

  let {
    workspace,
    session,
    desktop,
    diagnostics,
    workspaceCapabilities,
    codexThreads,
    piTree,
    executionProfile,
    attachments,
    artifacts,
    projectActions,
    projectActionRuns,
    turnChangeSet,
    checkpoints,
    restoreOperations,
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
    onApplyGitHunkAction,
    onReadArtifact,
    onSaveProjectAction,
    onDeleteProjectAction,
    onRunProjectAction,
    onRefresh,
  }: InspectorProps = $props();

  let expandedArtifactId = $state<string | null>(null);
  let artifactContent = $state<ArtifactContent | null>(null);
  let artifactLoading = $state(false);
  const turnFileIsRename = $derived(
    Boolean(turnChangeSet && turnFileDiff && turnChangeSet.files.find((file) => file.path === turnFileDiff.path)?.kind === 'renamed'),
  );
  async function toggleArtifact(artifact: Artifact): Promise<void> {
    if (expandedArtifactId === artifact.id) {
      expandedArtifactId = null;
      artifactContent = null;
      return;
    }
    if (!session) return;
    expandedArtifactId = artifact.id;
    artifactLoading = true;
    artifactContent = null;
    try {
      artifactContent = await onReadArtifact(session.id, artifact.id);
    } finally {
      artifactLoading = false;
    }
  }

  function modeLabel(mode: string): string {
    return mode === 'plan' ? '计划' : mode === 'edit' ? '编辑' : '问答';
  }

  function filesystemLabel(policy: string): string {
    return policy === 'workspace-write' ? '工作区可写' : '只读';
  }

  function commandLabel(policy: string): string {
    return policy === 'trusted' ? '自动执行' : policy === 'approved' ? '需审批' : '禁用';
  }

  function networkLabel(policy: string): string {
    return policy === 'agent-managed' ? 'Agent 管理' : '禁用';
  }

  function profileValue(label: (value: string) => string, requested: string, enforced: string): string {
    const requestedLabel = label(requested);
    const enforcedLabel = label(enforced);
    return requestedLabel === enforcedLabel ? enforcedLabel : `${requestedLabel} → ${enforcedLabel}`;
  }

  function optionalProfileValue(requested: string | null | undefined, enforced: string | null | undefined): string {
    const requestedLabel = requested ?? '默认';
    const enforcedLabel = enforced ?? '默认';
    return requestedLabel === enforcedLabel ? enforcedLabel : `${requestedLabel} → ${enforcedLabel}`;
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

  <ProjectActionsPanel
    workspace={workspace}
    {desktop}
    {projectActions}
    {projectActionRuns}
    {busy}
    {onSaveProjectAction}
    {onDeleteProjectAction}
    {onRunProjectAction}
  />

  {#if workspace && desktop}
    {#if !session}
    <Card class="capability-checker-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>Agent 能力检查</CardTitle>
        <Badge variant="outline">{diagnostics.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if diagnostics.length === 0}
          <p class="thread-empty">尚未读取本机 Agent 能力。</p>
        {:else}
          <div class="thread-list" aria-label="本机 Agent 能力检查">
            {#each diagnostics as agent (agent.agent)}
              <div class="thread-item capability-checker-item">
                <div class="thread-copy">
                  <strong>{agent.label}</strong>
                  <small>{agent.version ?? agent.message ?? '未检测到版本'}</small>
                </div>
                <Badge variant={agent.status === 'ready' ? 'success' : agent.status === 'missing' ? 'warning' : 'destructive'}>
                  {agent.status === 'ready' ? '可用' : agent.status === 'missing' ? '未安装' : '异常'}
                </Badge>
              </div>
              {#if agent.capabilities.length > 0}
                <div class="capability-list capability-checker-list">
                  {#each agent.capabilities as capability}<Badge variant="outline">{capability}</Badge>{/each}
                </div>
              {/if}
              {#if agent.message}<p class="thread-empty capability-checker-message">{agent.message}</p>{/if}
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
    {/if}
    {#if workspaceCapabilities}
      <Card class="workspace-capabilities-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>工作区能力</CardTitle>
          <Badge variant="outline">
            {workspaceCapabilities.instructions.length + workspaceCapabilities.skills.length + workspaceCapabilities.tools.length + workspaceCapabilities.mcpServers.length}
          </Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <div class="workspace-capability-groups">
            <section class="workspace-capability-group" aria-labelledby="workspace-instructions-title">
              <strong id="workspace-instructions-title">指令</strong>
              {#if workspaceCapabilities.instructions.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.instructions as entry (entry.source)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">未发现</small>{/if}
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-skills-title">
              <strong id="workspace-skills-title">Skills</strong>
              {#if workspaceCapabilities.skills.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.skills as entry (entry.source)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">未发现</small>{/if}
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-tools-title">
              <strong id="workspace-tools-title">Core 工具</strong>
              <div class="capability-list">
                {#each workspaceCapabilities.tools as entry (entry.name)}
                  <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                {/each}
              </div>
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-mcp-title">
              <strong id="workspace-mcp-title">MCP</strong>
              {#if workspaceCapabilities.mcpServers.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.mcpServers as entry (entry.source + entry.name)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">未发现</small>{/if}
            </section>
          </div>
          {#if workspaceCapabilities.warnings.length > 0}
            <p class="profile-warning">检查提示：{workspaceCapabilities.warnings.join('；')}</p>
          {/if}
        </CardContent>
      </Card>
    {/if}
  {/if}

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
    <Card class="artifacts-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>任务工件</CardTitle>
        <Badge variant={artifacts.length > 0 ? 'outline' : 'secondary'}>{artifacts.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if artifacts.length === 0}
          <p class="thread-empty">命令输出和验证结果会在这里保留。</p>
        {:else}
          <div class="thread-list" aria-label="任务工件">
            {#each artifacts as artifact (artifact.id)}
              <div class="thread-item changeset-file artifact-item">
                <Icon name="folder-add" size={13} />
                <div class="thread-copy">
                  <strong>{artifact.source}</strong>
                  <small>{artifact.mediaType} · {artifact.size} bytes · {artifact.turnId ? `本轮 ${artifact.turnId.slice(0, 8)}` : '会话级'} · {artifact.contentHash.slice(0, 16)}…</small>
                </div>
                <Button variant="ghost" size="sm" type="button" onclick={() => void toggleArtifact(artifact)} disabled={artifactLoading && expandedArtifactId === artifact.id}>
                  {expandedArtifactId === artifact.id ? '收起' : '查看'}
                </Button>
              </div>
              {#if expandedArtifactId === artifact.id}
                <div class="artifact-preview">
                  {#if artifactLoading}<span class="thread-empty">读取中…</span>
                  {:else if artifactContent}<pre>{artifactContent.content}{artifactContent.truncated ? '\n…内容已截断…' : ''}</pre>
                  {:else}<span class="thread-empty">工件内容不可用。</span>{/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
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
            <div><dt>模式</dt><dd>{profileValue(modeLabel, executionProfile.requested.interactionMode, executionProfile.enforced.interactionMode)}</dd></div>
            <div><dt>文件</dt><dd>{profileValue(filesystemLabel, executionProfile.requested.filesystemPolicy, executionProfile.enforced.filesystemPolicy)}</dd></div>
            <div><dt>命令</dt><dd>{profileValue(commandLabel, executionProfile.requested.commandPolicy, executionProfile.enforced.commandPolicy)}</dd></div>
            <div><dt>审批</dt><dd>{profileValue((value) => value, executionProfile.requested.approvalPolicy, executionProfile.enforced.approvalPolicy)}</dd></div>
            <div><dt>网络</dt><dd>{profileValue(networkLabel, executionProfile.requested.networkPolicy, executionProfile.enforced.networkPolicy)}</dd></div>
            {#if executionProfile.requested.model || executionProfile.enforced.model}<div><dt>模型</dt><dd>{optionalProfileValue(executionProfile.requested.model, executionProfile.enforced.model)}</dd></div>{/if}
            {#if executionProfile.requested.reasoningEffort || executionProfile.enforced.reasoningEffort}<div><dt>推理</dt><dd>{optionalProfileValue(executionProfile.requested.reasoningEffort, executionProfile.enforced.reasoningEffort)}</dd></div>{/if}
          </dl>
          {#if executionProfile.unsupported.length > 0}
            <p class="profile-warning">未启用：{executionProfile.unsupported.join('、')}</p>
          {/if}
        </CardContent>
      </Card>
      <Card class="capabilities-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>Agent 能力</CardTitle>
          <Badge variant="outline">{executionProfile.adapterCapabilities.length}</Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          {#if executionProfile.adapterCapabilities.length > 0}
            <div class="capability-list" aria-label="当前 Agent 能力">
              {#each executionProfile.adapterCapabilities as capability}
                <Badge variant="outline">{capability}</Badge>
              {/each}
            </div>
          {:else}
            <p class="thread-empty">适配器未报告额外能力。</p>
          {/if}
          {#if executionProfile.unsupported.length > 0}
            <p class="profile-warning">未支持：{executionProfile.unsupported.join('、')}</p>
          {/if}
        </CardContent>
      </Card>
    {/if}
    <Card class="attachments-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>上下文附件</CardTitle>
        <Badge variant={attachments.length > 0 ? 'outline' : 'secondary'}>{attachments.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if attachments.length === 0}
          <p class="thread-empty">发送前可在输入框添加文件或目录。</p>
        {:else}
          <div class="thread-list" aria-label="当前上下文附件">
            {#each attachments as attachment (attachment.id)}
              <div class="thread-item changeset-file">
                <Icon name={attachment.mediaType === 'inode/directory' ? 'folder' : 'folder-add'} size={13} />
                <div class="thread-copy">
                  <strong title={attachment.path}>{attachment.path}</strong>
                  <small>{attachment.turnId ? '已发送' : '待发送'} · {attachment.sendStrategy === 'reference' ? '工作区引用' : '内联'}{attachment.size === null ? '' : ` · ${attachment.size} bytes`}</small>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
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
          {#if checkpoints.length > 0}
            <div class="checkpoint-summary" aria-label="本轮 checkpoint">
              <div class="checkpoint-summary-heading">
                <span>Checkpoint · {checkpoints.filter((item) => item.available).length}/{checkpoints.length} 可恢复</span>
                <small>基线文件</small>
              </div>
              <div class="checkpoint-list">
                {#each checkpoints.slice(0, 6) as checkpoint (checkpoint.id)}
                  <div class="checkpoint-item">
                    <code title={checkpoint.path}>{checkpoint.path}</code>
                    <span class="checkpoint-item-badges">
                      {#if checkpoint.baselineDirty}<Badge variant="warning">混合</Badge>{/if}
                      <Badge variant={checkpoint.available ? 'success' : 'warning'}>{checkpoint.available ? '可恢复' : '不可用'}</Badge>
                    </span>
                  </div>
                {/each}
              </div>
              {#if checkpoints.length > 6}<small class="thread-more">还有 {checkpoints.length - 6} 个基线文件</small>{/if}
            </div>
          {/if}
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
                    <span class={`change-kind change-kind-${file.kind}`}>{file.kind === 'added' ? '+' : file.kind === 'deleted' ? '−' : file.kind === 'renamed' ? '↪' : '~'}</span>
                    <code title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
                      {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                    </code>
                    {#if file.baselineDirty}<Badge variant="warning">本轮前已有修改</Badge>{/if}
                  </Button>
                  {#if workspaceChanges?.captureStatus === 'captured'}
                    <div class="changeset-actions">
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'stage')} disabled={busy || sessionRunning || selectedSessionArchiving} title="暂存">暂存</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'unstage')} disabled={busy || sessionRunning || selectedSessionArchiving} title="取消暂存">撤销暂存</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'revert')} disabled={busy || sessionRunning || selectedSessionArchiving || file.baselineDirty} title={file.baselineDirty ? '本轮前已有修改，禁止整文件还原' : '撤销文件变更'}>还原</Button>
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
                {#if turnFileDiff.hunks.length > 0}
                  <div class="turn-diff-hunks" aria-label="文件 diff hunks">
                    {#each turnFileDiff.hunks as hunk (hunk.index)}
                      <details class="turn-diff-hunk" open={turnFileDiff.hunks.length === 1}>
                        <summary><code>Hunk {hunk.index + 1}</code><span>{hunk.header}</span></summary>
                        <pre>{hunk.content}</pre>
                        {#if !turnFileIsRename}
                          <div class="turn-diff-hunk-actions">
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'stage')} disabled={busy || sessionRunning || selectedSessionArchiving}>暂存</Button>
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'unstage')} disabled={busy || sessionRunning || selectedSessionArchiving}>撤销暂存</Button>
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'revert')} disabled={busy || sessionRunning || selectedSessionArchiving}>还原</Button>
                          </div>
                        {:else}
                          <small class="thread-empty">重命名文件请使用整轮恢复，以同时还原源路径。</small>
                        {/if}
                      </details>
                    {/each}
                  </div>
                {:else}
                  <pre>{turnFileDiff.diff || '没有可显示的 diff'}</pre>
                {/if}
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
    {#if restoreOperations.length > 0}
      <Card class="changeset-card restore-audit-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>恢复记录</CardTitle>
          <Badge variant="outline">{restoreOperations.length}</Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <div class="thread-list" aria-label="恢复审计记录">
            {#each restoreOperations.slice(0, 5) as operation (operation.id)}
              <div class="thread-item changeset-file">
                <span class={`change-kind ${operation.status === 'completed' ? 'change-kind-added' : operation.status === 'blocked' ? 'change-kind-modified' : 'change-kind-deleted'}`}>
                  {operation.status === 'completed' ? '✓' : operation.status === 'blocked' ? '!' : '×'}
                </span>
                <div class="thread-copy">
                  <strong>{operation.status === 'completed' ? '已恢复' : operation.status === 'blocked' ? '已阻止' : '恢复失败'}</strong>
                  <small>{operation.restored.length} 个已恢复 · {operation.conflicts.length} 个冲突 · {operation.unsupported.length} 个不可用</small>
                </div>
              </div>
            {/each}
          </div>
          {#if restoreOperations.length > 5}<small class="thread-more">还有 {restoreOperations.length - 5} 条恢复记录</small>{/if}
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
                  <code title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
                    {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  </code>
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
