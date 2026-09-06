<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Separator } from '$lib/ui-kit';
  import type { AgentCommand, AgentGoal, AgentQueueSnapshot, ApprovalDecision, ContextAttachment, SessionAccessMode, SessionExecutionProfile, SessionModelCatalog, UserInputRequest, WorkspacePathSuggestion } from '$lib/types';
  import type { UsageValues } from './view-models';
  import Composer from './Composer.svelte';
  import MarkdownContent from './MarkdownContent.svelte';
  import { sessionStateLabel } from './session-utils';
  import { groupTimelineItems, isDiffContent, toolLabel } from './timeline-utils';
  import type {
    ApprovalView,
    CodexThreadView,
    SessionPanelView,
    TimelineViewItem,
    WorkspaceListItem,
  } from './view-types';

  type TimelinePanelProps = {
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    selectedSessionId: string | null;
    codexGoal: AgentGoal | null;
    codexThreadSnapshot: CodexThreadView | null;
    timeline: TimelineViewItem[];
    timelineVisibleCount: number;
    usageValues: UsageValues | null;
    retryPrompt: string | null;
    retryReason: string | null;
    approvals: ApprovalView[];
    userInputRequests: UserInputRequest[];
    queueSnapshot: AgentQueueSnapshot | null;
    agentActivityLabel: string | null;
    contextCompacting: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    executionProfile: SessionExecutionProfile | null;
    modelCatalog: SessionModelCatalog | null;
    modelCatalogLoading: boolean;
    modelOverride?: string | null;
    workspacePathSuggestions: WorkspacePathSuggestion[];
    agentCommands: AgentCommand[];
    agentCommandsLoading: boolean;
    composerText?: string;
    composerDraftFailed: boolean;
    onAddAttachments: () => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onLoadOlderTimeline: () => void;
    onTimelineScroll: (event: Event) => void;
    onRetry: () => void;
    onResolveApproval: (requestId: string, decision: ApprovalDecision) => void;
    onResolveUserInput: (request: UserInputRequest, answers: Record<string, string[]>) => void | Promise<void>;
    onCancelUserInput: (request: UserInputRequest) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onClearQueue: () => void;
    onAbort: () => void;
    onSelectAccess: (mode: SessionAccessMode) => void | Promise<void>;
    onLoadModels: () => void | Promise<void>;
    onSelectModel: (model: string | null) => void | Promise<void>;
    onSelectReasoning: (reasoningEffort: string | null) => void | Promise<void>;
    onSelectModelConfiguration: (model: string, reasoningEffort: string | null) => void | Promise<void>;
    onCompact: () => void | Promise<void>;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    workspace,
    session,
    selectedSessionId,
    codexGoal,
    codexThreadSnapshot,
    timeline,
    timelineVisibleCount,
    usageValues,
    retryPrompt,
    retryReason,
    approvals,
    userInputRequests,
    queueSnapshot,
    agentActivityLabel,
    contextCompacting,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    executionProfile,
    modelCatalog,
    modelCatalogLoading,
    modelOverride = null,
    workspacePathSuggestions,
    agentCommands,
    agentCommandsLoading,
    composerText = $bindable(''),
    composerDraftFailed,
    onLoadOlderTimeline,
    onTimelineScroll,
    onRetry,
    onResolveApproval,
    onResolveUserInput,
    onCancelUserInput,
    onSend,
    onQueue,
    onClearQueue,
    onAbort,
    onSelectAccess,
    onLoadModels,
    onSelectModel,
    onSelectReasoning,
    onSelectModelConfiguration,
    onCompact,
    onAddAttachments,
    onAddDirectory,
    onRemoveAttachment,
    onComposerInput,
    onSelectWorkspacePath,
  }: TimelinePanelProps = $props();

  const visibleTimeline = $derived(
    timeline.slice(Math.max(0, timeline.length - timelineVisibleCount)),
  );
  const hiddenTimelineCount = $derived(Math.max(0, timeline.length - visibleTimeline.length));
  const sessionArchived = $derived(session?.archived === true);
  const contextPercent = $derived.by(() => {
    if (!usageValues || usageValues.contextUsed === null || !usageValues.contextLimit || usageValues.contextLimit <= 0) return null;
    return Math.min(100, Math.round((usageValues.contextUsed / usageValues.contextLimit) * 100));
  });
  let userInputDrafts = $state<Record<string, string>>({});

  function userInputKey(requestId: string, questionId: string): string {
    return `${requestId}:${questionId}`;
  }

  function setUserInputDraft(requestId: string, questionId: string, value: string): void {
    userInputDrafts = {
      ...userInputDrafts,
      [userInputKey(requestId, questionId)]: value,
    };
  }

  async function submitUserInput(request: UserInputRequest): Promise<void> {
    const answers: Record<string, string[]> = {};
    for (const question of request.questions) {
      const value = userInputDrafts[userInputKey(request.requestId, question.id)]?.trim() ?? '';
      if (!value) return;
      answers[question.id] = [value];
    }
    try {
      await onResolveUserInput(request, answers);
      userInputDrafts = Object.fromEntries(
        Object.entries(userInputDrafts).filter(([key]) => !key.startsWith(`${request.requestId}:`)),
      );
    } catch {
      // Keep the answers editable when the provider rejects or loses the request.
    }
  }

  function statusLabel(status: TimelineViewItem['status']): string {
    return status === 'streaming'
      ? '生成中'
      : status === 'completed'
        ? '完成'
        : status === 'failed'
          ? '失败'
          : status === 'queued'
            ? '排队中'
            : status === 'interrupted'
              ? '已中断'
              : status;
  }
</script>

<Card as="section" class="timeline" data-ui-component="timeline-panel" aria-label="会话时间线">
  <CardHeader class="panel-heading timeline-heading">
    <CardTitle>{session?.label ?? workspace?.label ?? '选择工作区'}</CardTitle>
    <div class="timeline-heading-actions">
      {#if codexGoal?.objective}
        <Badge variant="outline" title={codexGoal.objective}>目标 · {codexGoal.status}</Badge>
      {/if}
      {#if session}
        <Badge variant={sessionArchived ? 'secondary' : sessionRunning || selectedSessionArchiving ? 'warning' : 'outline'}>
          {selectedSessionArchiving ? '归档中' : sessionStateLabel(session)}
        </Badge>
        {#if codexThreadSnapshot && codexThreadSnapshot.id === session.externalSessionId}
          <Badge variant="outline">远端 {codexThreadSnapshot.turnCount} 轮</Badge>
        {/if}
      {/if}
      {#if workspace}
        <Badge variant={workspace.trust === 'trusted' ? 'success' : 'warning'}>
          {workspace.trust === 'trusted' ? '可信' : '待确认'}
        </Badge>
      {/if}
    </div>
  </CardHeader>
  {#if workspace}
    <Separator />

    {#if usageValues}
      <div class="usage-strip" aria-label="Token 使用量">
        <span>Token</span>
        {#if usageValues.input !== null}<span>输入 {usageValues.input}</span>{/if}
        {#if usageValues.output !== null}<span>输出 {usageValues.output}</span>{/if}
        {#if usageValues.total !== null}<span>总计 {usageValues.total}</span>{/if}
        {#if usageValues.contextUsed !== null}
          <span class:usage-estimated={usageValues.contextEstimated}>
            上下文 {usageValues.contextLimit ? `${contextPercent ?? 0}%` : '已用'}{usageValues.contextEstimated ? ' · 估算' : ''}
          </span>
        {/if}
        {#if session?.agent === 'pi' && !sessionRunning && !sessionArchived && usageValues.contextUsed !== null}
          <Button class="usage-compact-button" variant="ghost" size="sm" type="button" onclick={onCompact} disabled={busy || contextCompacting}>
            {contextCompacting ? '压缩中…' : '压缩上下文'}
          </Button>
        {/if}
      </div>
    {/if}

    {#if retryPrompt && session && !sessionRunning && !sessionArchived}
      <div class="timeline-retry" role="status">
        <span>{retryReason ?? '上一回合未完成，可以重试。'}</span>
        <Button variant="outline" size="sm" type="button" onclick={onRetry} disabled={busy || selectedSessionArchiving}>重试上一条</Button>
      </div>
    {/if}

    {#if timeline.length > 0}
      <div class="timeline-feed" aria-live="polite" onscroll={onTimelineScroll}>
        {#if hiddenTimelineCount > 0}
          <Button class="timeline-load-more" variant="ghost" size="sm" type="button" onclick={onLoadOlderTimeline}>
            加载更早的 {Math.min(hiddenTimelineCount, 80)} 条消息
          </Button>
        {/if}
        {#each groupTimelineItems(visibleTimeline) as renderItem (renderItem.id)}
          {#if renderItem.kind === 'tool-group'}
            <Card as="article" class="timeline-entry tool-entry tool-group-entry">
              <details class="tool-group">
                <summary>
                  <span class="tool-group-title">
                    <Badge variant="outline">TOOL</Badge>
                    <span>工具调用 · {renderItem.items.length} 项</span>
                  </span>
                  <Badge variant="outline">{renderItem.items.filter((item) => item.status === 'completed').length}/{renderItem.items.length} 完成</Badge>
                </summary>
                <div class="tool-group-items">
                  {#each renderItem.items as tool (tool.id)}
                    <details class="tool-output">
                      <summary>
                        <span class="tool-output-name">{toolLabel(tool)}</span>
                        <span class="tool-output-action">{isDiffContent(tool.content) ? '查看 diff' : '查看工具输出'}</span>
                      </summary>
                      <pre class:diff-content={isDiffContent(tool.content)}>{tool.content || '…'}</pre>
                    </details>
                  {/each}
                </div>
              </details>
            </Card>
          {:else}
            {@const item = renderItem.item}
            <Card
              as="article"
              class={`timeline-entry ${item.role === 'assistant' ? 'assistant-entry' : item.role === 'user' ? 'user-entry' : item.role === 'tool' ? 'tool-entry' : item.role === 'system' ? 'system-entry' : ''}`}
            >
              <div class="entry-meta">
                <Badge variant={item.role === 'assistant' ? 'secondary' : 'outline'}>{item.role === 'assistant' ? (session?.agent === 'pi' ? 'PI' : 'CODEX') : item.role.toUpperCase()}</Badge>
                <Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'queued' ? 'secondary' : 'outline'}>{statusLabel(item.status)}</Badge>
              </div>
              {#if item.role === 'tool'}
                <details class="tool-output">
                  <summary>
                    <span class="tool-output-name">{toolLabel(item)}</span>
                    <span class="tool-output-action">{isDiffContent(item.content) ? '查看 diff' : '查看工具输出'}</span>
                  </summary>
                  <pre class:diff-content={isDiffContent(item.content)}>{item.content || '…'}</pre>
                </details>
              {:else}
                <div class="entry-content">{#if item.content}<MarkdownContent content={item.content} />{:else}…{/if}</div>
              {/if}
            </Card>
          {/if}
        {/each}
      </div>
    {:else if session}
      <div class="timeline-empty compact-empty">
        <div class="orbit"><span></span><span></span><span></span></div>
        <h3>发送第一条消息</h3>
      </div>
    {:else}
      <div class="timeline-empty compact-empty">
        <div class="empty-symbol">+</div>
        <h3>新建会话</h3>
      </div>
    {/if}
  {:else}
    <div class="timeline-empty">
      <div class="empty-symbol">+</div>
      <h3>选择工作区</h3>
    </div>
  {/if}

  {#if userInputRequests.length > 0}
    <div class="user-input-list" aria-live="assertive">
      {#each userInputRequests as request (request.requestId)}
        <Card class="user-input-card">
          <CardHeader class="user-input-card-heading">
            <CardTitle>Agent 需要你的回答</CardTitle>
            <Badge variant="warning">{request.isBlocking ? '等待输入' : '可选输入'}</Badge>
          </CardHeader>
          <CardContent class="user-input-card-content">
            {#each request.questions as question (question.id)}
              <fieldset class="user-input-question">
                <legend>{question.header ?? '问题'}</legend>
                <p>{question.question}</p>
                {#if question.options.length > 0}
                  <div class="user-input-options">
                    {#each question.options as option (option.label)}
                      {@const key = userInputKey(request.requestId, question.id)}
                      <Button
                        type="button"
                        size="sm"
                        variant={userInputDrafts[key] === option.label ? 'secondary' : 'outline'}
                        onclick={() => setUserInputDraft(request.requestId, question.id, option.label)}
                      >
                        {option.label}
                      </Button>
                    {/each}
                  </div>
                {/if}
                {#if question.options.length === 0 || question.isOther}
                  <Input
                    value={userInputDrafts[userInputKey(request.requestId, question.id)] ?? ''}
                    placeholder={question.isOther ? '补充其他回答…' : '输入回答…'}
                    aria-label={question.question}
                    oninput={(event) => setUserInputDraft(request.requestId, question.id, (event.currentTarget as HTMLInputElement).value)}
                  />
                {/if}
              </fieldset>
            {/each}
            <div class="user-input-actions">
              <Button type="button" size="sm" variant="ghost" onclick={() => onCancelUserInput(request)} disabled={busy}>停止并取消</Button>
              <Button type="button" size="sm" onclick={() => submitUserInput(request)} disabled={busy}>提交回答</Button>
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}

  {#if approvals.length > 0}
    <div class="approval-list" aria-live="assertive">
      {#each approvals as approval (approval.requestId)}
        <Card class="approval-card">
          <CardHeader class="approval-card-heading">
            <CardTitle>需要确认</CardTitle>
            <Badge variant="warning">{approval.kind}</Badge>
          </CardHeader>
          <CardContent class="approval-card-content">
            {#if approval.command}<code>{approval.command}</code>{/if}
            {#if approval.cwd}<small>{approval.cwd}</small>{/if}
            <div class="approval-actions">
              {#if approval.availableDecisions.includes('cancel')}
                <Button variant="ghost" size="sm" type="button" onclick={() => onResolveApproval(approval.requestId, 'cancel')} disabled={busy}>拒绝</Button>
              {/if}
              {#if approval.availableDecisions.includes('accept')}
                <Button size="sm" type="button" onclick={() => onResolveApproval(approval.requestId, 'accept')} disabled={busy}>允许</Button>
              {/if}
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}

  {#if agentActivityLabel}
    <div class="agent-activity" role="status" aria-live="polite">
      <span class="activity-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>{agentActivityLabel}</span>
    </div>
  {/if}

  {#if queueSnapshot && (queueSnapshot.steering.length > 0 || queueSnapshot.followUp.length > 0)}
    <div class="agent-queue" role="status" aria-label="待处理消息队列">
      <div class="agent-queue-heading">
        <span>队列 · {queueSnapshot.steering.length + queueSnapshot.followUp.length}</span>
        <Button variant="ghost" size="sm" type="button" onclick={onClearQueue} disabled={busy || !sessionRunning}>清空</Button>
      </div>
      {#each queueSnapshot.steering as item, index}
        <div class="agent-queue-item"><Badge variant="secondary">插入</Badge><span>{item}</span><small>#{index + 1}</small></div>
      {/each}
      {#each queueSnapshot.followUp as item, index}
        <div class="agent-queue-item"><Badge variant="outline">跟进</Badge><span>{item}</span><small>#{index + 1}</small></div>
      {/each}
    </div>
  {/if}

  {#key session?.id}
  {#if composerDraftFailed}
    <div class="composer-draft-status" role="status">上次发送未完成，草稿已保留，可修改后重试。</div>
  {/if}
  <Composer
    selectedAgent={session?.agent ?? null}
    selectedSession={session !== null}
    {selectedSessionId}
    sessionArchived={sessionArchived}
    sessionRunning={sessionRunning}
    selectedSessionArchiving={selectedSessionArchiving}
    busy={busy}
    attachments={attachments}
    executionProfile={executionProfile}
    modelCatalog={modelCatalog}
    modelCatalogLoading={modelCatalogLoading}
    {modelOverride}
    workspacePathSuggestions={workspacePathSuggestions}
    agentCommands={agentCommands}
    agentCommandsLoading={agentCommandsLoading}
    bind:text={composerText}
    onAddAttachments={onAddAttachments}
    onAddDirectory={onAddDirectory}
    onRemoveAttachment={onRemoveAttachment}
    onSend={onSend}
    onQueue={onQueue}
    onAbort={onAbort}
    onSelectAccess={onSelectAccess}
    onLoadModels={onLoadModels}
    onSelectModel={onSelectModel}
    onSelectReasoning={onSelectReasoning}
    onSelectModelConfiguration={onSelectModelConfiguration}
    onComposerInput={onComposerInput}
    onSelectWorkspacePath={onSelectWorkspacePath}
  />
  {/key}
</Card>
