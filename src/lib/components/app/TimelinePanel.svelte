<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from '$lib/ui-kit';
  import type { AgentQueueSnapshot, ApprovalDecision, ContextAttachment } from '$lib/types';
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

  type UsageValues = {
    input: number | null;
    output: number | null;
    total: number | null;
  };

  type TimelinePanelProps = {
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    codexThreadSnapshot: CodexThreadView | null;
    timeline: TimelineViewItem[];
    timelineVisibleCount: number;
    usageValues: UsageValues | null;
    retryPrompt: string | null;
    retryReason: string | null;
    approvals: ApprovalView[];
    queueSnapshot: AgentQueueSnapshot | null;
    agentActivityLabel: string | null;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    composerText?: string;
    onAddAttachments: () => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onLoadOlderTimeline: () => void;
    onTimelineScroll: (event: Event) => void;
    onRetry: () => void;
    onResolveApproval: (requestId: string, decision: ApprovalDecision) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onClearQueue: () => void;
    onAbort: () => void;
  };

  let {
    workspace,
    session,
    codexThreadSnapshot,
    timeline,
    timelineVisibleCount,
    usageValues,
    retryPrompt,
    retryReason,
    approvals,
    queueSnapshot,
    agentActivityLabel,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    composerText = $bindable(''),
    onLoadOlderTimeline,
    onTimelineScroll,
    onRetry,
    onResolveApproval,
    onSend,
    onQueue,
    onClearQueue,
    onAbort,
    onAddAttachments,
    onAddDirectory,
    onRemoveAttachment,
  }: TimelinePanelProps = $props();

  const visibleTimeline = $derived(
    timeline.slice(Math.max(0, timeline.length - timelineVisibleCount)),
  );
  const hiddenTimelineCount = $derived(Math.max(0, timeline.length - visibleTimeline.length));
  const sessionArchived = $derived(session?.archived === true);

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

  <Composer
    selectedAgent={session?.agent ?? null}
    selectedSession={session !== null}
    sessionArchived={sessionArchived}
    sessionRunning={sessionRunning}
    selectedSessionArchiving={selectedSessionArchiving}
    busy={busy}
    attachments={attachments}
    bind:text={composerText}
    onAddAttachments={onAddAttachments}
    onAddDirectory={onAddDirectory}
    onRemoveAttachment={onRemoveAttachment}
    onSend={onSend}
    onQueue={onQueue}
    onAbort={onAbort}
  />
</Card>
