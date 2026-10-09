<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import BackgroundTaskCard from './BackgroundTaskCard.svelte';
  import { parseBackgroundTask } from '../../../../packages/presentation-workbench/background-tasks.js';
  import { AttachmentList } from '$lib/ui-kit';
  import { splitMessageAttachments } from '../../../../packages/presentation-workbench/message-attachments.js';
  import { parseSubagent } from '$lib/app/subagents';
  import { SubagentCard } from '$lib/ui-kit';
  import { tick } from 'svelte';
  import UserInputCard from './UserInputCard.svelte';
  import { createTimelineStickiness } from '$lib/app/timeline-stickiness';
  import type { Snippet } from 'svelte';
  import type { ModelConfigurationState } from '$lib/app/model-configuration';
  import { goalStatusLabel, goalCanResume } from '$lib/app/session-goal';
  import { sessionAgentKind } from '$lib/app/agent-kind';
  import { AgentStatusMark, GoalBar, Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { AgentCommand, AgentGoal, AgentQueueSnapshot, ContextAttachment, SessionControlId, SessionExecutionProfile, SessionModelCatalog, Session, UserInputRequest, ApprovalRequest, ApprovalChoice, WorkspacePathSuggestion } from '$lib/types';
  import type { UsageValues } from './view-models';
  import Composer from './Composer.svelte';
  import { splitSessionReferences } from '../../../../packages/presentation-workbench/session-references.js';
  import MarkdownContent from './MarkdownContent.svelte';
  import { sessionStateLabel, sessionStatusTone } from './session-utils';
  import { executionTiming } from '$lib/app/execution-record';
  import { toolGroupDuration, toolContentPreview } from '$lib/app/conversation-record';
  import { groupTimelineItems, isDiffContent, toolLabel } from './timeline-utils';
  import type {
    CodexThreadView,
    SessionPanelView,
    TimelineViewItem,
    WorkspaceListItem,
  } from './view-types';

  type TimelinePanelProps = {
    onOpenLink?: (url: string) => void;
    onOpenSubagent?: (id: string) => void;
    presentationActions?: Snippet;
    activeTab?: 'conversation' | 'executions' | 'changes';
    onSelectTab?: (tab: 'conversation' | 'executions' | 'changes') => void;
    changesPanel?: Snippet;
    changesCount?: number | null;
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    /** Provider name declared by the session's plugin, shown as the assistant's author label. */
    sessionProviderLabel?: string;
    sessionProviderIcon?: import('../../../../packages/plugin-protocol/src/agent-icon').AgentIcon;
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
    /** Pending approvals of this session; the host revalidates every submitted choice. */
    approvalRequests: ApprovalRequest[];
    userInputDrafts: Record<string, string>;
    onUserInputDraftChange: (value: Record<string, string>) => void;
    queueSnapshot: AgentQueueSnapshot | null;
    agentActivityLabel: string | null;
    contextCompacting: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    attachmentPreviews?: Record<string, string | null>;
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
    onPasteImages: (files: File[]) => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onLoadOlderTimeline: () => void;
    onForkSession: (throughTurnId?: string) => void;
    onOpenPiTree: () => void;
    onTimelineScroll: (event: Event) => void;
    onRetry: () => void;
    onResolveUserInput: (request: UserInputRequest, answers: Record<string, string[]>) => void | Promise<void>;
    onCancelUserInput: (request: UserInputRequest) => void;
    onResolveApproval: (approval: ApprovalRequest, choice: ApprovalChoice) => void | Promise<void>;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onClearQueue: () => void;
    onRemoveQueuedMessage: (id: string) => void;
    onSendQueuedMessage: (id: string) => void;
    onResumeQueue: () => void;
    onAbort: () => void;
    onSelectAccess: (mode: SessionControlId) => void | Promise<void>;
    onLoadModels: () => void | Promise<void>;
    onSelectModelConfiguration: (model: string, reasoningEffort: string | null) => void | Promise<void>;
    onSelectServiceTier: (serviceTier: string) => void | Promise<void>;
    onSelectContextWindow: (contextWindow: string, modelReference: string) => void | Promise<void>;
    onCompact: () => void | Promise<void>;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    onOpenLink,
    onOpenSubagent,
    presentationActions,
    activeTab = 'conversation',
    onSelectTab = () => {},
    changesPanel,
    changesCount = null,
    workspace,
    session,
    sessionProviderLabel,
    sessionProviderIcon,
    selectedSessionId,
    codexGoal,
    goalBusy = false,
    onClearGoal,
    onPauseGoal,
    onResumeGoal,
    timeline,
    timelineVisibleCount,
    usageValues,
    retryPrompt,
    retryReason,
    userInputRequests,
    approvalRequests,
    userInputDrafts,
    onUserInputDraftChange,
    queueSnapshot,
    agentActivityLabel,
    contextCompacting,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments, attachmentPreviews = {},
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
    onResolveApproval,
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
    onSelectContextWindow,
    onCompact,
    onAddAttachments, onPasteImages,
    onAddDirectory,
    onRemoveAttachment,
    onComposerInput,
    onSelectWorkspacePath,
  }: TimelinePanelProps = $props();
  const sessionKind = $derived(sessionAgentKind(session));
  const timelineStickiness = createTimelineStickiness();
  let expandedExecutionIds = $state<string[]>([]);
  let timelineFeed: HTMLElement | null = $state(null);
  let timelineContent: HTMLElement | null = $state(null);
  let showScrollToBottom = $state(false);

  function scrollTimelineToBottom(): void {
    if (timelineFeed && activeTab === 'conversation') {
      timelineStickiness.scrollToBottom(timelineFeed);
      timelineStickiness.updateFromScroll(timelineFeed);
      showScrollToBottom = !timelineStickiness.shouldStick();
    }
  }

  function jumpToLatest(): void {
    timelineStickiness.reset();
    scrollTimelineToBottom();
    timelineFeed?.focus({ preventScroll: true });
  }

  function handleTimelineViewportScroll(event: Event): void {
    const viewport = event.currentTarget as HTMLElement;
    timelineStickiness.updateFromScroll(viewport);
    showScrollToBottom = !timelineStickiness.shouldStick();
    onTimelineScroll(event);
  }

  $effect(() => {
    selectedSessionId;
    const viewport = timelineFeed;
    timelineStickiness.reset();
    showScrollToBottom = false;
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
  function countStatus(items: readonly TimelineViewItem[], ...statuses: TimelineViewItem['status'][]): number {
    return items.filter((item) => statuses.includes(item.status)).length;
  }

  function statusLabel(status: TimelineViewItem['status']): string {
    return status === 'streaming'
      ? $t('timeline.streaming')
      : status === 'completed'
        ? $t('timeline.completed')
        : status === 'failed'
          ? $t('timeline.failed')
          : status === 'queued'
            ? $t('timeline.queued')
            : status === 'interrupted'
              ? $t('timeline.interrupted')
              : status;
  }

</script>

{#snippet activity()}
  {#if agentActivityLabel}
    <div class="agent-activity" role="status" aria-live="polite">
      <AgentStatusMark agent="plugin" icon={sessionProviderIcon} tone={session ? sessionStatusTone(session) : 'idle'} label={sessionProviderLabel ?? $t('role.assistant')} />
      <span>{agentActivityLabel}</span>
    </div>
  {/if}
{/snippet}

<Card as="section" class="timeline" data-ui-component="timeline-panel" aria-label={$t('timeline.title')}>
  <CardHeader class="panel-heading timeline-heading">
    <div class="timeline-heading-copy"><small>{workspace?.label ?? 'Aibo'}{#if session} / {sessionProviderLabel ?? session.agent}{/if}</small><CardTitle>{session?.label ?? workspace?.label ?? $t('timeline.chooseWorkspace')}</CardTitle></div>
    <div class="conversation-navigation" role="tablist" aria-label={$t('timeline.views')}>
      {#each [{ id: 'conversation', label: $t('timeline.conversation') }, { id: 'executions', label: $t('timeline.executions') }, { id: 'changes', label: $t('timeline.changes') }] as tab}
        <Button variant={activeTab === tab.id ? 'secondary' : 'ghost'} role="tab" id={`session-tab-${tab.id}`} aria-controls={`session-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabindex={activeTab === tab.id ? 0 : -1}
          onclick={() => onSelectTab(tab.id as typeof activeTab)}
          onkeydown={(event) => {
            const ids = ['conversation', 'executions', 'changes'] as const;
            const index = ids.indexOf(activeTab);
            const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
            if (next < 0) return;
            event.preventDefault(); onSelectTab(ids[next]);
            document.getElementById(`session-tab-${ids[next]}`)?.focus();
          }}>{tab.label}{#if tab.id === 'changes' && changesCount !== null}<Badge class="session-changes-count" variant="outline">{changesCount}</Badge>{/if}</Button>
      {/each}
    </div>
    <div class="timeline-heading-actions">
      {#if session}
        {@const runningTasks = timeline.filter(item => parseBackgroundTask(item, $locale)?.status === 'running').length}
        {#if runningTasks}<Badge variant="outline">{$t('timeline.runningTasks', { count: runningTasks })}</Badge>{/if}
        <span class="timeline-session-status" data-tone={selectedSessionArchiving ? 'attention' : sessionStatusTone(session)} role="status">
          <span class="timeline-session-signal" aria-hidden="true"></span>
          <span>{selectedSessionArchiving ? $t('sidebar.archiving') : sessionStateLabel(session, $locale)}</span>
        </span>
        {#if session?.capabilities.includes('session.fork') && !sessionArchived}
          <Button variant="ghost" size="sm" type="button" onclick={() => onForkSession()} disabled={busy || sessionRunning || selectedSessionArchiving} title={$t('timeline.latestFork')}>
            <Icon name="branch" size={13} /> {$t('timeline.branch')}
          </Button>
        {/if}
        {#if session?.capabilities.includes('session.tree')}
          <Button variant="ghost" size="sm" type="button" onclick={onOpenPiTree} disabled={selectedSessionArchiving} title={$t('timeline.openTree')}>
            <Icon name="branch" size={13} /> {$t('tree.title')}
          </Button>
        {/if}
      {/if}
      {#if workspace && workspace.trust !== 'trusted'}
        <Badge variant="warning">{$t('timeline.unconfirmed')}</Badge>
      {/if}
      {@render presentationActions?.()}
    </div>
  </CardHeader>
  <div role="tabpanel" id="session-panel-conversation" aria-labelledby="session-tab-conversation" class="conversation-tab-content" hidden={activeTab !== 'conversation'}>
  {#if workspace}

    {#if retryPrompt && session && !sessionRunning && !sessionArchived}
      <div class="timeline-retry" role="status">
        <span>{retryReason ?? $t('timeline.retryReason')}</span>
        <Button variant="outline" size="sm" type="button" onclick={onRetry} disabled={busy || selectedSessionArchiving}>{$t('timeline.retry')}</Button>
      </div>
    {/if}

    {#if timeline.length > 0}
      <div bind:this={timelineFeed} data-presentation-timeline tabindex="-1" class="timeline-feed" aria-live="polite" onscroll={handleTimelineViewportScroll}>
        <div bind:this={timelineContent} class="timeline-feed-content">
        {#if hiddenTimelineCount > 0}
          <Button class="timeline-load-more" variant="ghost" size="sm" type="button" onclick={onLoadOlderTimeline}>
            {$t('timeline.olderMessages', { count: Math.min(hiddenTimelineCount, 80) })}
          </Button>
        {/if}
        {#each groupTimelineItems(visibleTimeline, session?.capabilities.includes('session.timeline') ?? false) as renderItem (renderItem.id)}
          {#if renderItem.kind === 'tool-group'}
            {@const duration = toolGroupDuration(renderItem.items)}
            <Card as="article" data-presentation-message={'message-group:' + renderItem.id} class="timeline-entry tool-entry tool-group-entry">
              <details class="tool-group">
                <summary>
                  <Icon name="chevron-down" class="disclosure-chevron" />
                  <span class="tool-group-title">
                    <Icon name="terminal" />
                    <span>{$t('timeline.toolCalls', { count: renderItem.items.length })}</span>
                  </span>
                  <span class="tool-group-meta">
                    {#if countStatus(renderItem.items, 'failed') > 0}{$t('timeline.failedCount', { count: countStatus(renderItem.items, 'failed') })}{/if}
                    {#if countStatus(renderItem.items, 'streaming', 'queued') > 0}{$t('timeline.activeCount', { count: countStatus(renderItem.items, 'streaming', 'queued') })}{/if}
                    {#if countStatus(renderItem.items, 'interrupted') > 0}{$t('timeline.interruptedCount', { count: countStatus(renderItem.items, 'interrupted') })}{/if}
                    {#if duration}<span title={$t('timeline.durationDescription')}>· {duration}</span>{/if}
                  </span>
                </summary>
                <div class="tool-group-items">
                  {#each renderItem.items as tool (tool.id)}
                    {@const timing = executionTiming(tool, $locale)}
                    {@const preview = toolContentPreview(tool.content)}
                    <details class="tool-output">
                      <summary title={tool.entryType === 'tool_call' ? $t('timeline.parameters') : isDiffContent(tool.content) ? $t('timeline.viewDiff') : $t('subagent.viewTool')}>
                        <span class="tool-record-status" data-status={tool.status} aria-label={statusLabel(tool.status)} title={statusLabel(tool.status)}>{tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '✕' : tool.status === 'interrupted' ? '−' : '…'}</span>
                        <span class="tool-record-name" title={tool.toolName ?? $t('role.tool')}>{tool.toolName || $t('role.tool')}</span>
                        <span class="tool-record-target" title={preview}>{preview}</span>
                        {#if timing.durationLabel !== '—'}<span class="tool-record-duration" title={timing.durationTitle}>{toolGroupDuration([tool])}</span>{/if}
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
                  <Icon name="chevron-down" class="disclosure-chevron" />
                  <span class="tool-group-title">
                    <Icon name="diagnostics" size={14} />
                    <span>{$t('timeline.systemCount', { count: renderItem.items.length })}</span>
                  </span>
                </summary>
                <div class="tool-group-items">
                  {#each renderItem.items as systemItem (systemItem.id)}
                    <details class="tool-output">
                      <summary>
                        <span class="tool-output-name">{systemItem.content.split('\n')[0] || $t('timeline.systemMessage')}</span>
                        <span class="tool-output-action">{$t('timeline.details')}</span>
                      </summary>
                      <div class="entry-content"><MarkdownContent {onOpenLink} content={systemItem.content} /></div>
                    </details>
                  {/each}
                </div>
              </details>
            </Card>
          {:else}
            {@const item = renderItem.item}
            {@const timing = executionTiming(item, $locale)}
            {@const child = item.toolName === 'subagent' ? parseSubagent(item.content) : null}
            {@const backgroundTask = parseBackgroundTask(item, $locale)}
            {#if backgroundTask}
              <div data-presentation-message={'message:' + item.id}><BackgroundTaskCard task={backgroundTask} /></div>
            {:else if child}
              <div data-presentation-message={'message:' + item.id}><SubagentCard name={child.name} task={child.task} statusLabel={$t(`subagent.status.${child.status}`)} activity={child.activity} failed={['failed','unavailable'].includes(child.status)} onOpen={() => onOpenSubagent?.(child.id)} /></div>
            {:else}
            <Card
              as="article"
              data-presentation-message={'message:' + item.id}
              class={`timeline-entry ${item.role === 'tool' || (item.role === 'system' && item.toolName === 'reasoning') ? 'compact-record' : ''} ${item.role === 'assistant' ? 'assistant-entry' : item.role === 'user' ? 'user-entry' : item.role === 'tool' ? 'tool-entry' : item.role === 'system' ? 'system-entry' : ''}`}
            >
              <div class="entry-meta">
                {#if item.role === 'assistant'}<AgentStatusMark agent="plugin" icon={sessionProviderIcon} tone="idle" label={sessionProviderLabel ?? $t('role.assistant')} />{/if}
                <span class="entry-author">{item.role === 'assistant' ? (sessionProviderLabel ?? session?.agent ?? $t('role.assistant')) : item.role === 'user' ? $t('timeline.you') : item.role === 'system' && item.toolName === 'reasoning' ? $t('timeline.thinking') : item.role === 'tool' ? $t('role.tool') : $t('role.system')}</span>
                {#if timing.dateTime && (item.role === 'user' || item.role === 'assistant')}<time datetime={timing.dateTime} title={timing.dateTime}>{timing.timeLabel}</time>{/if}
                <div class="entry-meta-actions">
                  {#if item.status !== 'completed'}<Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'queued' ? 'secondary' : 'outline'}>{statusLabel(item.status)}</Badge>{/if}
                  {#if session?.capabilities.includes('session.fork') && !sessionArchived && item.turnId && forkBoundaryMessageIds.has(item.id)}
                    <Button variant="ghost" size="icon" type="button" aria-label={$t('timeline.replyForkLabel')} title={$t('timeline.replyFork')} onclick={() => onForkSession(item.turnId!)} disabled={busy || sessionRunning || selectedSessionArchiving}>
                      <Icon name="branch" size={13} />
                    </Button>
                  {/if}
                </div>
              </div>
              {#if item.toolName === 'reasoning' && item.role === 'system'}
                <details class="tool-output">
                  <summary>{$t('timeline.reasoningDetails')}</summary>
                  <div class="entry-content"><MarkdownContent {onOpenLink} content={item.content} /></div>
                </details>
              {:else if item.role === 'tool'}
                <details class="tool-output">
                  <summary>
                    <span class="tool-output-name">{toolLabel(item, $locale)}</span>
                    <span class="tool-output-action">{item.entryType === 'tool_call' ? $t('timeline.parameters') : isDiffContent(item.content) ? $t('timeline.viewDiff') : $t('subagent.viewTool')}</span>
                  </summary>
                  <pre class:diff-content={isDiffContent(item.content)}>{item.content || '…'}</pre>
                </details>
              {:else}
                {@const attached = item.role === 'user' ? splitMessageAttachments(item.content, attachments) : { body:item.content, attachments:[] }}
                {@const message = item.role === 'user' ? splitSessionReferences(attached.body) : { body: item.content, references: [] }}
                <div class="entry-content">{#if message.body}<MarkdownContent {onOpenLink} content={message.body} />{:else if !message.references.length && !attached.attachments.length}…{/if}</div>
                <AttachmentList items={attached.attachments} previews={attachmentPreviews} />
                {#each message.references as reference, index (`${reference.id}-${index}`)}
                  <details class="tool-output">
                    <summary>{$t('timeline.reference', { title: reference.title })}</summary>
                    <p>{reference.agent} · {reference.note}{reference.omitted === null ? '' : $t('timeline.omitted', { count: reference.omitted })}</p>
                    {#each reference.excerpts as excerpt}
                      <p>{excerpt.role === 'user' ? $t('role.user') : $t('role.assistant')}{excerpt.truncated ? $t('timeline.excerptTruncated') : ''}</p>
                      <pre>{excerpt.text}</pre>
                    {/each}
                  </details>
                {/each}
              {/if}
            </Card>
            {/if}
          {/if}
        {/each}
        {@render activity()}
        </div>
      </div>
    {:else if session}
      <div class="timeline-empty compact-empty">
        <div class="orbit"><span></span><span></span><span></span></div>
        <h3>{$t('timeline.welcome')}</h3>
        <p>{$t('timeline.welcomeDescription')}</p>
      </div>
    {:else}
      <div class="timeline-empty compact-empty">
        <div class="empty-symbol">+</div>
        <h3>{$t('commands.new')}</h3>
      </div>
    {/if}
    {#if timeline.length === 0}{@render activity()}{/if}
  {:else}
    <div class="timeline-empty">
      <div class="empty-symbol">+</div>
      <h3>{$t('timeline.chooseWorkspace')}</h3>
    </div>
  {/if}

  {#if timeline.length > 0 && showScrollToBottom}
    <div class="timeline-bottom-action">
      <Button variant="secondary" size="sm" type="button" onclick={jumpToLatest} title={$t('timeline.toBottom')}>
        <Icon name="chevron-down" size={16} /> {$t('timeline.toBottom')}
      </Button>
    </div>
  {/if}
  </div>
  {#if activeTab === 'executions'}
    <div role="tabpanel" id="session-panel-executions" aria-labelledby="session-tab-executions" class="timeline-feed" tabindex="0">
      {#if !session}<p role="status">{$t('timeline.selectSession')}</p>
      {:else}
        {#if timeline.some(item => item.role === 'tool')}
          <table class="execution-table" aria-label={$t('timeline.executions')}>
            <colgroup><col class="execution-status-column" /><col /><col class="execution-duration-column" /><col class="execution-time-column" /></colgroup>
            <thead><tr><th scope="col">{$t('timeline.status')}</th><th scope="col">{$t('timeline.commandTool')}</th><th scope="col">{$t('timeline.duration')}</th><th scope="col">{$t('timeline.time')}</th></tr></thead>
            <tbody>
              {#each timeline.filter(item => item.role === 'tool') as item, index (item.id)}
                {@const timing = executionTiming(item, $locale)}
                {@const executionKey = `${selectedSessionId}:${item.id}`}
                {@const expanded = expandedExecutionIds.includes(executionKey)}
                <tr class="execution-record" data-status={item.status}>
                  <td><span class="execution-status" role="img" aria-label={statusLabel(item.status)} title={statusLabel(item.status)}>{item.status === 'completed' ? '✓' : item.status === 'failed' ? '×' : item.status === 'interrupted' ? '!' : '…'}</span></td>
                  <td><Button variant="ghost" class="execution-toggle" aria-label={`${toolLabel(item, $locale)} · ${item.entryType === 'tool_call' ? $t('timeline.parameters') : $t('timeline.results')}`} aria-expanded={expanded} aria-controls={`execution-detail-${index}`} title={toolLabel(item, $locale)} onclick={() => expandedExecutionIds = expanded ? expandedExecutionIds.filter(id => id !== executionKey) : [...expandedExecutionIds, executionKey]}><span>{toolLabel(item, $locale)}</span><Icon name="chevron-down" size={12} aria-hidden="true" /></Button></td>
                  <td class="execution-duration" title={timing.durationTitle}>{timing.durationLabel}</td>
                  <td><time datetime={timing.dateTime} title={timing.dateTime}>{timing.timeLabel}</time></td>
                </tr>
                <tr class="execution-detail" hidden={!expanded} id={`execution-detail-${index}`}><td colspan="4"><pre>{item.content || '…'}</pre></td></tr>
              {/each}
            </tbody>
          </table>
        {:else}<p role="status">{$t('timeline.noExecutions')}</p>{/if}
      {/if}
    </div>
  {:else if activeTab === 'changes'}
    <div role="tabpanel" id="session-panel-changes" aria-labelledby="session-tab-changes" class="timeline-feed" tabindex="0">
      {#if session && changesPanel}{@render changesPanel()}{:else}<p role="status">{$t('timeline.selectSession')}</p>{/if}
    </div>
  {/if}

  {#if approvalRequests.length > 0}
    <section class="approval-list" aria-label={$t('approval.list')} aria-live="assertive">
      {#each approvalRequests as approval (approval.requestId)}
        <Card class="approval-card">
          <CardHeader class="approval-card-heading">
            <CardTitle>{$t('approval.required')}</CardTitle>
            <Badge variant="warning">{approval.kind}</Badge>
          </CardHeader>
          <CardContent class="approval-card-content">
            {#if approval.command || approval.cwd}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable approval text must be keyboard accessible.) -->
              <div class="approval-details" role="region" aria-label={$t('approval.details')} tabindex="0">
                {#if approval.command}<code>{approval.command}</code>{/if}
                {#if approval.cwd}<small>{approval.cwd}</small>{/if}
              </div>
            {/if}
            <div class="approval-actions">
              {#if approval.options.length > 0}
                <!-- Provider-offered options: reject kinds first and muted, allow kinds as the primary action. -->
                {#each [...approval.options].sort((left, right) => left.kind === right.kind ? 0 : left.kind === 'reject' ? -1 : 1) as option (option.id)}
                  <Button variant={option.kind === 'reject' ? 'ghost' : 'default'} size="sm" onclick={() => void onResolveApproval(approval, { optionId: option.id })} disabled={busy}>{option.label ?? (option.kind === 'allow' ? $t('approval.allow') : $t('approval.reject'))}</Button>
                {/each}
              {:else}
                {#if approval.availableDecisions.includes('cancel')}
                  <Button variant="ghost" size="sm" onclick={() => void onResolveApproval(approval, 'cancel')} disabled={busy}>{$t('approval.reject')}</Button>
                {/if}
                {#if approval.availableDecisions.includes('accept')}
                  <Button size="sm" onclick={() => void onResolveApproval(approval, 'accept')} disabled={busy}>{$t('approval.allow')}</Button>
                {/if}
              {/if}
            </div>
          </CardContent>
        </Card>
      {/each}
    </section>
  {/if}

  {#if userInputRequests.length > 0}
    <div class="user-input-list" aria-live="assertive">
      {#each userInputRequests as request (JSON.stringify([request.sessionId, request.requestId, request.turnId]))}
        <UserInputCard {request} drafts={userInputDrafts} {busy}
          onDraftChange={onUserInputDraftChange} onResolve={onResolveUserInput} onCancel={onCancelUserInput} />
      {/each}
    </div>
  {/if}

  {#if queueSnapshot && (queueSnapshot.items?.length || queueSnapshot.steering.length > 0 || queueSnapshot.followUp.length > 0)}
    <div class="agent-queue" role="status" aria-label={$t('queue.list')}>
      <div class="agent-queue-heading">
        <span>{$t('queue.count', { count: queueSnapshot.items?.length || queueSnapshot.steering.length + queueSnapshot.followUp.length })}</span>
        <Button variant="ghost" size="sm" type="button" onclick={onClearQueue} disabled={busy || sessionArchived || session?.historyOnly || selectedSessionArchiving}>{$t('queue.clear')}</Button>
      </div>
      {#if queueSnapshot.paused}
        <div class="agent-queue-item"><span>{$t('queue.paused')}</span><Button variant="ghost" size="sm" onclick={onResumeQueue} disabled={busy || sessionArchived || session?.historyOnly || selectedSessionArchiving || queueSnapshot.items?.some(item => item.status === 'uncertain')}>{$t('queue.resume')}</Button></div>
      {/if}
      {#if queueSnapshot.items?.length}
        {#each queueSnapshot.items as item (item.id)}
          <div class="agent-queue-item">
            <Badge variant="outline">{item.status === 'sending' ? $t('queue.sending') : item.status === 'uncertain' ? $t('queue.uncertain') : item.status === 'failed' ? $t('queue.failed') : $t('queue.waiting')}</Badge>
            <span title={item.text}>{item.text.split('[AIBO_SESSION_REFERENCES]')[0].split('[AIBO_CONTEXT_ATTACHMENTS]')[0].trim()}</span>
            {#if !sessionRunning || session?.capabilities.includes('queue.steer')}
            <Button variant="ghost" size="sm" onclick={() => onSendQueuedMessage(item.id)} disabled={busy || sessionArchived || session?.historyOnly || selectedSessionArchiving || item.status === 'sending' || item.status === 'uncertain'}>{$t('composer.sendNow')}</Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => onRemoveQueuedMessage(item.id)} disabled={busy || sessionArchived || session?.historyOnly || selectedSessionArchiving || item.status === 'sending'}>{$t('common.delete')}</Button>
          </div>
          <AttachmentList items={splitMessageAttachments(item.text, attachments).attachments} previews={attachmentPreviews} />
          {#if item.error}<div role="status">{item.error}</div>{/if}
        {/each}
      {:else}
        {#each queueSnapshot.steering as item, index}
          <div class="agent-queue-item"><Badge variant="secondary">{$t('queue.steering')}</Badge><span>{item}</span><small>#{index + 1}</small></div>
        {/each}
        {#each queueSnapshot.followUp as item, index}
          <div class="agent-queue-item"><Badge variant="outline">{$t('queue.followUp')}</Badge><span>{item}</span><small>#{index + 1}</small></div>
        {/each}
      {/if}
    </div>
  {/if}

  {#key session?.id}
  {#if composerDraftFailed}
    <div class="composer-draft-status" role="status">{$t('timeline.draftPreserved')}</div>
  {/if}
  {#if codexGoal?.objective && codexGoal.status !== 'cleared'}
    <GoalBar objective={codexGoal.objective}
      statusLabel={goalStatusLabel(codexGoal, sessionRunning, $locale)}
      usageLabel={codexGoal.tokenBudget !== null ? `Token ${codexGoal.tokensUsed ?? 0} / ${codexGoal.tokenBudget}` : codexGoal.tokensUsed !== null ? `Token ${codexGoal.tokensUsed}` : null}
      busy={goalBusy || selectedSessionArchiving}
      onPause={!sessionArchived && session?.capabilities.includes('goal.pause') && (codexGoal.status === 'active' || codexGoal.status === 'paused' && sessionRunning) ? onPauseGoal : undefined}
      onResume={!sessionArchived && !sessionRunning && session?.capabilities.includes('goal.resume') && goalCanResume(codexGoal) ? onResumeGoal : undefined}
      onClear={sessionArchived || sessionRunning ? undefined : onClearGoal} />
  {/if}
  <Composer
    historyOnly={session?.historyOnly ?? false}
    selectedAgent={sessionKind === 'plugin' ? null : sessionKind}
    selectedSession={session !== null}
    sessionCapabilities={session?.capabilities ?? []}
    {selectedSessionId}
    sessionArchived={sessionArchived}
    sessionRunning={sessionRunning}
    sessionStarting={session?.state === 'starting'}
    selectedSessionArchiving={selectedSessionArchiving}
    busy={busy}
    attachments={attachments}
    {attachmentPreviews}
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
    onPasteImages={onPasteImages}
    onAddDirectory={onAddDirectory}
    onRemoveAttachment={onRemoveAttachment}
    onSend={onSend}
    onQueue={onQueue}
    onAbort={onAbort}
    onSelectAccess={onSelectAccess}
    onLoadModels={onLoadModels}
    onSelectModelConfiguration={onSelectModelConfiguration}
    onSelectServiceTier={onSelectServiceTier}
    onSelectContextWindow={onSelectContextWindow}
    onComposerInput={onComposerInput}
    onSelectWorkspacePath={onSelectWorkspacePath}
  />
  {/key}
  {#if usageValues && session?.capabilities.includes('compaction.run') && !sessionRunning && !sessionArchived && usageValues.contextUsed !== null}
    <div class="composer-context-actions">
      <Button class="usage-compact-button" variant="ghost" size="sm" type="button" onclick={onCompact} disabled={busy || contextCompacting}>
        {contextCompacting ? $t('timeline.compacting') : $t('commands.compact')}
      </Button>
    </div>
  {/if}
</Card>

<style>
  .conversation-tab-content { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
  .conversation-tab-content[hidden] { display: none; }
  .timeline-bottom-action { position: absolute; bottom: 12px; left: 0; right: 0; display: flex; justify-content: center; pointer-events: none; }
  .timeline-bottom-action :global(button) { pointer-events: auto; }
</style>
