<script lang="ts">
  import { parseSubagent, subagentStatusLabels } from '$lib/app/subagents';
  import { SubagentCard } from '$lib/ui-kit';
  import { tick } from 'svelte';
  import { userInputDraftKey, answeredRequest } from '$lib/app/user-input-drafts';
  import { createTimelineStickiness } from '$lib/app/timeline-stickiness';
  import type { Snippet } from 'svelte';
  import type { ModelConfigurationState } from '$lib/app/model-configuration';
  import { goalStatusLabel, goalCanResume } from '$lib/app/session-goal';
  import { sessionAgentKind } from '$lib/app/agent-kind';
  import { GoalBar, Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Input, Separator } from '$lib/ui-kit';
  import type { AgentCommand, AgentGoal, AgentQueueSnapshot, ContextAttachment, SessionAccessMode, SessionExecutionProfile, SessionModelCatalog, Session, UserInputRequest, WorkspacePathSuggestion } from '$lib/types';
  import type { UsageValues } from './view-models';
  import Composer from './Composer.svelte';
  import { splitSessionReferences } from '../../../../packages/presentation-workbench/session-references.js';
  import MarkdownContent from './MarkdownContent.svelte';
  import { sessionStateLabel } from './session-utils';
  import { groupTimelineItems, isDiffContent, toolLabel } from './timeline-utils';
  import type {
    CodexThreadView,
    SessionPanelView,
    TimelineViewItem,
    WorkspaceListItem,
  } from './view-types';

  type TimelinePanelProps = {
    onOpenSubagent?: (id: string) => void;
    presentationActions?: Snippet;
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    selectedSessionId: string | null;
    codexGoal: AgentGoal | null;
    goalBusy?: boolean;
    onClearGoal?: () => void;
    onPauseGoal?: () => void;
    onResumeGoal?: () => void;
    codexThreadSnapshot: CodexThreadView | null;
    timeline: TimelineViewItem[];
    timelineVisibleCount: number;
    usageValues: UsageValues | null;
    retryPrompt: string | null;
    retryReason: string | null;
    userInputRequests: UserInputRequest[];
    userInputDrafts: Record<string, string>;
    onUserInputDraftChange: (value: Record<string, string>) => void;
    queueSnapshot: AgentQueueSnapshot | null;
    agentActivityLabel: string | null;
    contextCompacting: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    executionProfile: SessionExecutionProfile | null;
    modelConfiguration: ModelConfigurationState;
    modelCatalog: SessionModelCatalog | null;
    modelCatalogLoading: boolean;
    modelOverride?: string | null;
    workspacePathSuggestions: WorkspacePathSuggestion[];
    sessionSuggestions?: Session[];
    sessionIcons?: Record<string, import('../../../../packages/plugin-protocol/src/agent-icon').AgentIcon | undefined>;
    onSelectSessionReference?: (id: string) => void | Promise<void>;
    agentCommands: AgentCommand[];
    agentCommandsLoading: boolean;
    composerText?: string;
    composerDraftFailed: boolean;
    onAddAttachments: () => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onLoadOlderTimeline: () => void;
    onForkSession: (throughTurnId?: string) => void;
    onOpenPiTree: () => void;
    onTimelineScroll: (event: Event) => void;
    onRetry: () => void;
    onResolveUserInput: (request: UserInputRequest, answers: Record<string, string[]>) => void | Promise<void>;
    onCancelUserInput: (request: UserInputRequest) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onClearQueue: () => void;
    onRemoveQueuedMessage: (id: string) => void;
    onSendQueuedMessage: (id: string) => void;
    onResumeQueue: () => void;
    onAbort: () => void;
    onSelectAccess: (mode: SessionAccessMode) => void | Promise<void>;
    onLoadModels: () => void | Promise<void>;
    onSelectModelConfiguration: (model: string, reasoningEffort: string | null) => void | Promise<void>;
    onSelectServiceTier: (serviceTier: string) => void | Promise<void>;
    onCompact: () => void | Promise<void>;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    onOpenSubagent,
    presentationActions,
    workspace,
    session,
    selectedSessionId,
    codexGoal,
    goalBusy = false,
    onClearGoal,
    onPauseGoal,
    onResumeGoal,
    codexThreadSnapshot,
    timeline,
    timelineVisibleCount,
    usageValues,
    retryPrompt,
    retryReason,
    userInputRequests,
    userInputDrafts,
    onUserInputDraftChange,
    queueSnapshot,
    agentActivityLabel,
    contextCompacting,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    executionProfile,
    modelConfiguration,
    modelCatalog,
    modelCatalogLoading,
    modelOverride = null,
    workspacePathSuggestions,
    sessionSuggestions = [],
    sessionIcons = {},
    onSelectSessionReference,
    agentCommands,
    agentCommandsLoading,
    composerText = $bindable(''),
    composerDraftFailed,
    onLoadOlderTimeline,
    onForkSession,
    onOpenPiTree,
    onTimelineScroll,
    onRetry,
    onResolveUserInput,
    onCancelUserInput,
    onSend,
    onQueue,
    onClearQueue,
    onRemoveQueuedMessage,
    onSendQueuedMessage,
    onResumeQueue,
    onAbort,
    onSelectAccess,
    onLoadModels,
    onSelectModelConfiguration,
    onSelectServiceTier,
    onCompact,
    onAddAttachments,
    onAddDirectory,
    onRemoveAttachment,
    onComposerInput,
    onSelectWorkspacePath,
  }: TimelinePanelProps = $props();
  const sessionKind = $derived(sessionAgentKind(session));
  const timelineStickiness = createTimelineStickiness();
  let timelineFeed: HTMLElement | null = $state(null);
  let timelineContent: HTMLElement | null = $state(null);

  function scrollTimelineToBottom(): void {
    if (timelineFeed) timelineStickiness.scrollToBottom(timelineFeed);
  }

  function handleTimelineViewportScroll(event: Event): void {
    const viewport = event.currentTarget as HTMLElement;
    timelineStickiness.updateFromScroll(viewport);
    onTimelineScroll(event);
  }

  $effect(() => {
    selectedSessionId;
    const viewport = timelineFeed;
    timelineStickiness.reset();
    if (viewport) void tick().then(scrollTimelineToBottom);
  });

  $effect(() => {
    const viewport = timelineFeed;
    const content = timelineContent;
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scrollTimelineToBottom());
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  });

  const visibleTimeline = $derived(
    timeline.slice(Math.max(0, timeline.length - timelineVisibleCount)),
  );
  const hiddenTimelineCount = $derived(Math.max(0, timeline.length - visibleTimeline.length));
  const sessionArchived = $derived(session?.archived === true);
  const forkBoundaryMessageIds = $derived.by(() => {
    const lastCompletedAssistantByTurn = new Map<string, string>();
    for (const item of timeline) {
      if (item.role === 'assistant' && item.status === 'completed' && item.turnId) {
        lastCompletedAssistantByTurn.set(item.turnId, item.id);
      }
    }
    return new Set(lastCompletedAssistantByTurn.values());
  });
  const contextPercent = $derived.by(() => {
    if (!usageValues || usageValues.contextUsed === null || !usageValues.contextLimit || usageValues.contextLimit <= 0) return null;
    return Math.min(100, Math.round((usageValues.contextUsed / usageValues.contextLimit) * 100));
  });
  function userInputKey(request: UserInputRequest, questionId: string): string {
    return userInputDraftKey(request, questionId);
  }

  function setUserInputDraft(request: UserInputRequest, questionId: string, value: string): void {
    onUserInputDraftChange({ ...userInputDrafts, [userInputKey(request, questionId)]: value });
  }

  async function submitUserInput(request: UserInputRequest): Promise<void> {
    const answers = answeredRequest(request, userInputDrafts);
    if (!answers) return;
    try { await onResolveUserInput(request, answers); } catch {
      // The host keeps drafts when the provider rejects or loses the request.
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

  function compactNumber(value: number): string {
    return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function limitLabel(limit: UsageValues['limits'][number]): string {
    if (limit.label) return limit.label;
    if (limit.windowMinutes && limit.windowMinutes % 1440 === 0) return `${limit.windowMinutes / 1440} 天`;
    if (limit.windowMinutes && limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60} 小时`;
    return limit.windowMinutes ? `${limit.windowMinutes} 分钟` : '套餐';
  }
</script>

<Card as="section" class="timeline" data-ui-component="timeline-panel" aria-label="会话时间线">
  <CardHeader class="panel-heading timeline-heading">
    <CardTitle>{session?.label ?? workspace?.label ?? '选择工作区'}</CardTitle>
    <div class="timeline-heading-actions">
          {@render presentationActions?.()}
      {#if session}
        {#if sessionKind === 'codex' && !sessionArchived}
          <Button variant="ghost" size="sm" type="button" onclick={() => onForkSession()} disabled={busy || sessionRunning || selectedSessionArchiving} title="从最新完成的回复创建分支">
            <Icon name="branch" size={13} /> 分支
          </Button>
        {:else if sessionKind === 'pi'}
          <Button variant="ghost" size="sm" type="button" onclick={onOpenPiTree} disabled={selectedSessionArchiving} title="打开 Pi 会话树">
            <Icon name="branch" size={13} /> 会话树
          </Button>
        {/if}
        <Badge variant={sessionArchived ? 'secondary' : sessionRunning || selectedSessionArchiving ? 'warning' : 'outline'}>
          {selectedSessionArchiving ? '归档中' : sessionStateLabel(session)}
        </Badge>
        {#if codexThreadSnapshot && codexThreadSnapshot.id === session.externalSessionId}
          <Badge variant="outline">{codexThreadSnapshot.turnCount === null ? '远端轮次未知' : `远端 ${codexThreadSnapshot.turnCount} 轮`}</Badge>
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

    {#if retryPrompt && session && !sessionRunning && !sessionArchived}
      <div class="timeline-retry" role="status">
        <span>{retryReason ?? '上一回合未完成，可以重试。'}</span>
        <Button variant="outline" size="sm" type="button" onclick={onRetry} disabled={busy || selectedSessionArchiving}>重试上一条</Button>
      </div>
    {/if}

    {#if timeline.length > 0}
      <div bind:this={timelineFeed} data-presentation-timeline class="timeline-feed" aria-live="polite" onscroll={handleTimelineViewportScroll}>
        <div bind:this={timelineContent} class="timeline-feed-content">
        {#if hiddenTimelineCount > 0}
          <Button class="timeline-load-more" variant="ghost" size="sm" type="button" onclick={onLoadOlderTimeline}>
            加载更早的 {Math.min(hiddenTimelineCount, 80)} 条消息
          </Button>
        {/if}
        {#each groupTimelineItems(visibleTimeline, sessionKind === 'pi') as renderItem (renderItem.id)}
          {#if renderItem.kind === 'tool-group'}
            <Card as="article" data-presentation-message={'message-group:' + renderItem.id} class="timeline-entry tool-entry tool-group-entry">
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
                        <span class="tool-output-action">{tool.entryType === 'tool_call' ? '查看调用参数' : isDiffContent(tool.content) ? '查看 diff' : '查看工具输出'}</span>
                      </summary>
                      <pre class:diff-content={isDiffContent(tool.content)}>{tool.content || '…'}</pre>
                    </details>
                  {/each}
                </div>
              </details>
            </Card>
          {:else if renderItem.kind === 'system-group'}
            <Card as="article" data-presentation-message={'message-group:' + renderItem.id} class="timeline-entry system-entry tool-group-entry">
              <details class="tool-group">
                <summary>
                  <span class="tool-group-title">
                    <Badge variant="outline">SYSTEM</Badge>
                    <span>系统消息 · {renderItem.items.length} 项</span>
                  </span>
                </summary>
                <div class="tool-group-items">
                  {#each renderItem.items as systemItem (systemItem.id)}
                    <details class="tool-output">
                      <summary>
                        <span class="tool-output-name">{systemItem.content.split('\n')[0] || '系统消息'}</span>
                        <span class="tool-output-action">查看详情</span>
                      </summary>
                      <div class="entry-content"><MarkdownContent content={systemItem.content} /></div>
                    </details>
                  {/each}
                </div>
              </details>
            </Card>
          {:else}
            {@const item = renderItem.item}
            {@const child = item.toolName === 'subagent' ? parseSubagent(item.content) : null}
            {#if child}
              <div data-presentation-message={'message:' + item.id}><SubagentCard name={child.name} task={child.task} statusLabel={subagentStatusLabels[child.status]} activity={child.activity} failed={['failed','unavailable'].includes(child.status)} onOpen={() => onOpenSubagent?.(child.id)} /></div>
            {:else}
            <Card
              as="article"
              data-presentation-message={'message:' + item.id}
              class={`timeline-entry ${item.role === 'assistant' ? 'assistant-entry' : item.role === 'user' ? 'user-entry' : item.role === 'tool' ? 'tool-entry' : item.role === 'system' ? 'system-entry' : ''}`}
            >
              <div class="entry-meta">
                <Badge variant={item.role === 'assistant' ? 'secondary' : 'outline'}>{item.role === 'assistant' ? (sessionKind === 'pi' ? 'PI' : sessionKind === 'codex' ? 'CODEX' : 'AGENT') : item.role === 'system' && item.toolName === 'reasoning' ? 'THINKING' : item.role.toUpperCase()}</Badge>
                <div class="entry-meta-actions">
                  <Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'queued' ? 'secondary' : 'outline'}>{statusLabel(item.status)}</Badge>
                  {#if sessionKind === 'codex' && !sessionArchived && item.turnId && forkBoundaryMessageIds.has(item.id)}
                    <Button variant="ghost" size="icon" type="button" aria-label="从此回复创建会话分支" title="从此回复创建分支" onclick={() => onForkSession(item.turnId!)} disabled={busy || sessionRunning || selectedSessionArchiving}>
                      <Icon name="branch" size={13} />
                    </Button>
                  {/if}
                </div>
              </div>
              {#if item.toolName === 'reasoning' && item.role === 'system'}
                <details class="tool-output">
                  <summary>思考 · 查看详情</summary>
                  <div class="entry-content"><MarkdownContent content={item.content} /></div>
                </details>
              {:else if item.role === 'tool'}
                <details class="tool-output">
                  <summary>
                    <span class="tool-output-name">{toolLabel(item)}</span>
                    <span class="tool-output-action">{item.entryType === 'tool_call' ? '查看调用参数' : isDiffContent(item.content) ? '查看 diff' : '查看工具输出'}</span>
                  </summary>
                  <pre class:diff-content={isDiffContent(item.content)}>{item.content || '…'}</pre>
                </details>
              {:else}
                {@const message = item.role === 'user' ? splitSessionReferences(item.content) : { body: item.content, references: [] }}
                <div class="entry-content">{#if message.body}<MarkdownContent content={message.body} />{:else if !message.references.length}…{/if}</div>
                {#each message.references as reference, index (`${reference.id}-${index}`)}
                  <details class="tool-output">
                    <summary>引用会话 · {reference.title}</summary>
                    <p>{reference.agent} · {reference.note}{reference.omitted === null ? '' : ` · 已省略 ${reference.omitted} 条消息`}</p>
                    {#each reference.excerpts as excerpt}
                      <p>{excerpt.role === 'user' ? '用户' : '助手'}{excerpt.truncated ? ' · 已截取' : ''}</p>
                      <pre>{excerpt.text}</pre>
                    {/each}
                  </details>
                {/each}
              {/if}
            </Card>
            {/if}
          {/if}
        {/each}
        </div>
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
                      {@const key = userInputKey(request, question.id)}
                      <Button
                        type="button"
                        size="sm"
                        variant={userInputDrafts[key] === option.label ? 'secondary' : 'outline'}
                        onclick={() => setUserInputDraft(request, question.id, option.label)}
                      >
                        {option.label}
                      </Button>
                    {/each}
                  </div>
                {/if}
                {#if question.options.length === 0 || question.isOther}
                  <Input
                    value={userInputDrafts[userInputKey(request, question.id)] ?? ''}
                    placeholder={question.isOther ? '补充其他回答…' : '输入回答…'}
                    aria-label={question.question}
                    oninput={(event) => setUserInputDraft(request, question.id, (event.currentTarget as HTMLInputElement).value)}
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

  {#if agentActivityLabel}
    <div class="agent-activity" role="status" aria-live="polite">
      <span class="activity-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span>{agentActivityLabel}</span>
    </div>
  {/if}

  {#if queueSnapshot && (queueSnapshot.items?.length || queueSnapshot.steering.length > 0 || queueSnapshot.followUp.length > 0)}
    <div class="agent-queue" role="status" aria-label="待处理消息队列">
      <div class="agent-queue-heading">
        <span>队列 · {queueSnapshot.items?.length || queueSnapshot.steering.length + queueSnapshot.followUp.length}</span>
        <Button variant="ghost" size="sm" type="button" onclick={onClearQueue} disabled={busy || sessionArchived || selectedSessionArchiving}>清空</Button>
      </div>
      {#if queueSnapshot.paused}
        <div class="agent-queue-item"><span>自动发送已暂停</span><Button variant="ghost" size="sm" onclick={onResumeQueue} disabled={busy || sessionArchived || selectedSessionArchiving || queueSnapshot.items?.some(item => item.status === 'uncertain')}>继续队列</Button></div>
      {/if}
      {#if queueSnapshot.items?.length}
        {#each queueSnapshot.items as item (item.id)}
          <div class="agent-queue-item">
            <Badge variant="outline">{item.status === 'sending' ? '发送中' : item.status === 'uncertain' ? '结果未知' : item.status === 'failed' ? '发送失败' : '等待'}</Badge>
            <span title={item.text}>{item.text.split('[AIBO_SESSION_REFERENCES]')[0].split('[AIBO_CONTEXT_ATTACHMENTS]')[0].trim()}</span>
            {#if !sessionRunning || session?.capabilities.includes('queue.steer')}
            <Button variant="ghost" size="sm" onclick={() => onSendQueuedMessage(item.id)} disabled={busy || sessionArchived || selectedSessionArchiving || item.status === 'sending' || item.status === 'uncertain'}>立即发送</Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => onRemoveQueuedMessage(item.id)} disabled={busy || sessionArchived || selectedSessionArchiving || item.status === 'sending'}>删除</Button>
          </div>
          {#if item.error}<div role="status">{item.error}</div>{/if}
        {/each}
      {:else}
        {#each queueSnapshot.steering as item, index}
          <div class="agent-queue-item"><Badge variant="secondary">插入</Badge><span>{item}</span><small>#{index + 1}</small></div>
        {/each}
        {#each queueSnapshot.followUp as item, index}
          <div class="agent-queue-item"><Badge variant="outline">跟进</Badge><span>{item}</span><small>#{index + 1}</small></div>
        {/each}
      {/if}
    </div>
  {/if}

  {#key session?.id}
  {#if composerDraftFailed}
    <div class="composer-draft-status" role="status">上次发送未完成，草稿已保留，可修改后重试。</div>
  {/if}
  {#if codexGoal?.objective && codexGoal.status !== 'cleared'}
    <GoalBar objective={codexGoal.objective}
      statusLabel={goalStatusLabel(codexGoal, sessionRunning)}
      usageLabel={codexGoal.tokenBudget !== null ? `Token ${codexGoal.tokensUsed ?? 0} / ${codexGoal.tokenBudget}` : codexGoal.tokensUsed !== null ? `Token ${codexGoal.tokensUsed}` : null}
      busy={goalBusy || selectedSessionArchiving}
      onPause={!sessionArchived && session?.capabilities.includes('goal.pause') && (codexGoal.status === 'active' || codexGoal.status === 'paused' && sessionRunning) ? onPauseGoal : undefined}
      onResume={!sessionArchived && !sessionRunning && session?.capabilities.includes('goal.resume') && goalCanResume(codexGoal) ? onResumeGoal : undefined}
      onClear={sessionArchived || sessionRunning ? undefined : onClearGoal} />
  {/if}
  <Composer
    selectedAgent={sessionKind === 'plugin' ? null : sessionKind}
    selectedSession={session !== null}
    sessionCapabilities={session?.capabilities ?? []}
    {selectedSessionId}
    sessionArchived={sessionArchived}
    sessionRunning={sessionRunning}
    selectedSessionArchiving={selectedSessionArchiving}
    busy={busy}
    attachments={attachments}
    executionProfile={executionProfile}
    {modelConfiguration}
    modelCatalog={modelCatalog}
    modelCatalogLoading={modelCatalogLoading}
    {modelOverride}
    workspacePathSuggestions={workspacePathSuggestions}
    {sessionSuggestions}
    {sessionIcons}
    {onSelectSessionReference}
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
    onSelectModelConfiguration={onSelectModelConfiguration}
    onSelectServiceTier={onSelectServiceTier}
    onComposerInput={onComposerInput}
    onSelectWorkspacePath={onSelectWorkspacePath}
  />
  {/key}
  {#if usageValues}
    <div class="usage-strip composer-usage-strip" aria-label="会话用量与套餐余量">
      {#if usageValues.contextUsed !== null}
        <span class:usage-estimated={usageValues.contextEstimated} title={usageValues.contextLimit ? `${usageValues.contextUsed} / ${usageValues.contextLimit} tokens` : `${usageValues.contextUsed} tokens`}>
          上下文 {usageValues.contextLimit ? `${contextPercent ?? 0}%` : compactNumber(usageValues.contextUsed)}{usageValues.contextEstimated ? ' · 估算' : ''}
        </span>
      {/if}
      {#if usageValues.total !== null}<span title={`输入 ${usageValues.input ?? '—'} · 输出 ${usageValues.output ?? '—'}`}>Token {compactNumber(usageValues.total)}</span>{/if}
      {#if usageValues.plan}<span>{usageValues.plan.toUpperCase()}</span>{/if}
      {#each usageValues.limits as limit (limit.id)}
        <span title={limit.resetsAt ? `重置于 ${new Date(limit.resetsAt * 1000).toLocaleString()}` : undefined}>{limitLabel(limit)}剩余 {Math.max(0, 100 - Math.round(limit.usedPercent))}%</span>
      {/each}
      {#if usageValues.credits?.unlimited}<span>Credits 不限量</span>{:else if usageValues.credits?.balance}<span>Credits {usageValues.credits.balance}</span>{/if}
      {#if sessionKind === 'pi' && !sessionRunning && !sessionArchived && usageValues.contextUsed !== null}
        <Button class="usage-compact-button" variant="ghost" size="sm" type="button" onclick={onCompact} disabled={busy || contextCompacting}>
          {contextCompacting ? '压缩中…' : '压缩上下文'}
        </Button>
      {/if}
    </div>
  {/if}
</Card>
