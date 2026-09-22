<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { AgentStatusMark, Button, Card, CardHeader, CardTitle, Icon, Input } from '$lib/ui-kit';
  import type { SessionFilter } from '$lib/types';
  import { relativeTimeLabel, sessionStateLabel, sessionStatusTone, isSessionRunning } from './session-utils';
  import type { SessionListItem, WorkspaceListItem } from './view-types';
  import type { SessionProviderChoice } from '$lib/app/session-providers';

  type WorkspaceSidebarProps = {
    presentationActions?: Snippet;
    footerActions?: Snippet;
    workspaces: WorkspaceListItem[];
    sessionsByWorkspace: Record<string, SessionListItem[]>;
    selectedWorkspaceId: string | null;
    expandedWorkspaceIds: string[];
    selectedSessionId: string | null;
    sessionsLoadingWorkspaceIds: string[];
    busy: boolean;
    threadBusy: boolean;
    archivingWorkspaceId: string | null;
    archivingSessionId: string | null;
    sessionSearchOpen: boolean;
    sessionFilterOpen: boolean;
    sessionSearch?: string;
    sessionFilter?: SessionFilter;
    createSessionWorkspaceId: string | null;
    renamingSessionId: string | null;
    sessionLabelDraft?: string;
    onToggleSearch: () => void;
    onToggleFilter: () => void;
    onApplyFilters: () => void;
    onChooseWorkspaceDirectory: () => void;
    onSelectWorkspace: (workspaceId: string) => void;
    onToggleSessionCreator: (workspaceId: string) => void;
    onToggleTrust: (workspaceId: string) => void;
    onDeleteWorkspace: (workspaceId: string) => void;
    onOpenWorkspaceLocation: (workspaceId: string) => void;
    agentChoices: SessionProviderChoice[];
    onCreateAgent: (workspaceId: string, choiceId: string) => void;
    onSelectSession: (sessionId: string) => void;
    onUnarchiveSession: (sessionId: string) => void;
    onRequestArchiveSession: (sessionId: string) => void;
    onSyncCodexThread: (sessionId: string) => void;
    onBeginRenameSession: (sessionId: string) => void;
    onSaveSessionRename: () => void;
    onCancelRenameSession: () => void;
  };

  let {
    presentationActions,
    footerActions,
    workspaces,
    sessionsByWorkspace,
    selectedWorkspaceId,
    expandedWorkspaceIds,
    selectedSessionId,
    sessionsLoadingWorkspaceIds,
    busy,
    threadBusy,
    archivingWorkspaceId,
    archivingSessionId,
    sessionSearchOpen,
    sessionFilterOpen,
    sessionSearch = $bindable(''),
    sessionFilter = $bindable<SessionFilter>('active'),
    createSessionWorkspaceId,
    renamingSessionId,
    sessionLabelDraft = $bindable(''),
    onToggleSearch,
    onToggleFilter,
    onApplyFilters,
    onChooseWorkspaceDirectory,
    onSelectWorkspace,
    onToggleSessionCreator,
    onToggleTrust,
    onDeleteWorkspace,
    onOpenWorkspaceLocation,
    agentChoices,
    onCreateAgent,
    onSelectSession,
    onUnarchiveSession,
    onRequestArchiveSession,
    onSyncCodexThread,
    onBeginRenameSession,
    onSaveSessionRename,
    onCancelRenameSession,
  }: WorkspaceSidebarProps = $props();
  const workspaceLocationLabel = navigator.platform.startsWith('Mac')
    ? 'Finder'
    : navigator.platform.startsWith('Win')
      ? '文件资源管理器'
      : '文件管理器';
  const AGENTS_PER_RING = 6;
  const FIRST_RING_RADIUS = 30;
  const RING_GAP = 34;
  const agentRingCount = $derived(Math.max(1, Math.ceil(agentChoices.length / AGENTS_PER_RING)));
  const agentWheelBackdropSize = $derived((FIRST_RING_RADIUS + (agentRingCount - 1) * RING_GAP + 18) * 2);
  const agentLaunchers = new Map<string, HTMLElement>();
  let primaryLauncher: HTMLElement | null = null;
  const menuPrefix = $props.id();
  let rowMenuPosition = $state({ left: 0, top: 0 });
  function positionRowMenu(trigger: HTMLButtonElement) {
    const bounds = trigger.getBoundingClientRect();
    rowMenuPosition = { left: bounds.right - 224, top: bounds.bottom + 4 };
  }
  function closeRowMenu(event: MouseEvent) {
    (event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover();
  }
  function focusRowMenu(event: ToggleEvent) {
    if (event.newState === 'open') (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  let agentWheelPosition = $state<{ left: number; top: number } | null>(null);

  function registerAgentLauncher(node: HTMLElement, workspaceId: string) {
    agentLaunchers.set(workspaceId, node);
    return {
      destroy: () => agentLaunchers.delete(workspaceId),
    };
  }

  function updateAgentWheelPosition(): void {
    if (!createSessionWorkspaceId) {
      agentWheelPosition = null;
      return;
    }
    const launcher = primaryLauncher?.isConnected ? primaryLauncher : agentLaunchers.get(createSessionWorkspaceId);
    if (!launcher) return;
    const bounds = launcher.getBoundingClientRect();
    agentWheelPosition = {
      left: bounds.left,
      top: bounds.bottom + 4,
    };
  }

  $effect(() => {
    const openWorkspaceId = createSessionWorkspaceId;
    const frame = requestAnimationFrame(() => {
      updateAgentWheelPosition();
      if (openWorkspaceId) void tick().then(() => {
        if (createSessionWorkspaceId === openWorkspaceId) document.getElementById(`session-agent-wheel-${openWorkspaceId}`)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      });
    });
    window.addEventListener('resize', updateAgentWheelPosition);
    document.addEventListener('scroll', updateAgentWheelPosition, true);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!openWorkspaceId || !(event.target instanceof Element)) return;
      if (event.target.closest('.session-agent-wheel, .session-agent-launcher, .sidebar-new-session')) return;
      onToggleSessionCreator(openWorkspaceId);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || !openWorkspaceId) return;
      event.preventDefault(); closeSessionCreator();
    };
    if (openWorkspaceId) document.addEventListener('keydown', closeOnEscape);
    if (openWorkspaceId) document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateAgentWheelPosition);
      document.removeEventListener('scroll', updateAgentWheelPosition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  });

  function closeSessionCreator(): void {
    const workspaceId = createSessionWorkspaceId;
    if (!workspaceId) return;
    const trigger = primaryLauncher ?? agentLaunchers.get(workspaceId)?.querySelector<HTMLElement>('button');
    onToggleSessionCreator(workspaceId);
    void tick().then(() => trigger?.focus());
  }

  function agentWheelStyle(index: number): string {
    const ring = Math.floor(index / AGENTS_PER_RING);
    const ringStart = ring * AGENTS_PER_RING;
    const ringCount = Math.min(AGENTS_PER_RING, agentChoices.length - ringStart);
    const angle = ((index - ringStart) * 360) / ringCount - 90;
    return `--agent-angle: ${angle}deg; --agent-radius: ${FIRST_RING_RADIUS + ring * RING_GAP}px`;
  }


</script>

<Card as="aside" class="sidebar" data-ui-component="workspace-sidebar" aria-label="工作区">
  <Button class="sidebar-new-session" type="button" disabled={busy}
    aria-expanded={Boolean(createSessionWorkspaceId)}
    aria-controls={createSessionWorkspaceId ? `session-agent-wheel-${createSessionWorkspaceId}` : undefined}
    onclick={(event) => {
      const workspaceId = selectedWorkspaceId ?? workspaces[0]?.id;
      if (!workspaceId) { onChooseWorkspaceDirectory(); return; }
      primaryLauncher = event.currentTarget;
      onToggleSessionCreator(workspaceId);
    }}><span>新建会话</span><Icon name="add" size={16} /></Button>
  <CardHeader class="panel-heading">
    <CardTitle>工作区</CardTitle>
    <div class="workspace-toolbar" aria-label="工作区工具">
          {@render presentationActions?.()}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        class={sessionSearchOpen || sessionSearch ? 'active' : undefined}
        aria-label="搜索会话"
        title="搜索会话"
        aria-pressed={sessionSearchOpen}
        onclick={onToggleSearch}
      >
        <Icon name="search" size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        class={sessionFilterOpen || sessionFilter !== 'active' ? 'active' : undefined}
        aria-label="筛选会话"
        title="筛选会话"
        aria-pressed={sessionFilterOpen}
        onclick={onToggleFilter}
      >
        <Icon name="filter" size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label="添加工作区"
        title="添加工作区"
        onclick={onChooseWorkspaceDirectory}
        disabled={busy}
      >
        <Icon name="folder-add" size={16} />
      </Button>
    </div>
  </CardHeader>

  {#if sessionSearchOpen || sessionFilterOpen}
    <form
      class="workspace-tool-panel session-filter-form"
      aria-label="会话搜索与筛选"
      onsubmit={(event) => {
        event.preventDefault();
        onApplyFilters();
      }}
    >
      {#if sessionSearchOpen}
        <Input class="session-search-input" bind:value={sessionSearch} placeholder="搜索会话…" aria-label="搜索会话或消息" />
      {/if}
      {#if sessionFilterOpen}
        <select
          class="session-filter-select"
          bind:value={sessionFilter}
          aria-label="会话状态筛选"
          onchange={onApplyFilters}
        >
          <option value="active">活动</option>
          <option value="all">全部</option>
          <option value="archived">已归档</option>
          <option value="running">运行中</option>
          <option value="waiting_approval">待审批</option>
          <option value="idle">空闲</option>
          <option value="interrupted">已中断</option>
          <option value="failed">失败</option>
          <option value="closed">已关闭</option>
        </select>
      {/if}
      <Button variant="ghost" size="icon" type="submit" aria-label="应用搜索和筛选" disabled={!selectedWorkspaceId}>
        <Icon name="search" size={14} />
      </Button>
    </form>
  {/if}

  <div class="workspace-list" aria-label="工作区列表">
    {#if workspaces.length === 0}
      <div class="empty-list">暂无工作区</div>
    {:else}
      {#each workspaces as workspace (workspace.id)}
        {@const workspaceExpanded = expandedWorkspaceIds.includes(workspace.id)}
        {@const workspaceSessions = sessionsByWorkspace[workspace.id] ?? []}
        <div class:expanded={workspaceExpanded} class="workspace-group">
          <div
            class:session-creator-open={createSessionWorkspaceId === workspace.id}
            class="workspace-item-row"
          >
            <Button
              variant="ghost"
              class="workspace-item"
              type="button"
              aria-expanded={workspaceExpanded}
              aria-controls={workspaceExpanded ? `workspace-sessions-${workspace.id}` : undefined}
              aria-label={`${workspace.label}，${workspace.trust === 'trusted' ? '可信' : '待确认'}`}
              title={`${workspace.label}\n${workspace.path}`}
              onclick={() => onSelectWorkspace(workspace.id)}
            >
              {#if workspaceExpanded}
                <Icon name="chevron-down" class="workspace-leading-icon" size={16} />
              {:else}
                <Icon name="folder" class="workspace-leading-icon" size={16} />
              {/if}
              <span class="workspace-copy">
                <strong>{workspace.label}</strong>
              </span>
              <span class:trusted={workspace.trust === 'trusted'} class="trust-dot workspace-trust-dot" title={workspace.trust === 'trusted' ? '可信' : '待确认'}></span>
            </Button>
            <div class="workspace-item-actions" aria-label={`${workspace.label} 管理操作`}>
              <div class="session-agent-launcher" use:registerAgentLauncher={workspace.id}>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  class="session-agent-trigger"
                  aria-label="新建 Agent 会话"
                  title="新建会话"
                  aria-expanded={createSessionWorkspaceId === workspace.id}
                  aria-controls={createSessionWorkspaceId === workspace.id ? `session-agent-wheel-${workspace.id}` : undefined}
                  onclick={(event) => { event.stopPropagation(); primaryLauncher = null; onToggleSessionCreator(workspace.id); }}
                  disabled={busy}
                >
                  <Icon name="add" size={15} />
                </Button>
              </div>
              <Button variant="ghost" size="icon" type="button" aria-label={`${workspace.label} 更多操作`} title="更多工作区操作" popovertarget={`${menuPrefix}-workspace-${workspace.id}`} onclick={event => positionRowMenu(event.currentTarget)}><span aria-hidden="true" class="row-more-mark">···</span></Button>
              <div id={`${menuPrefix}-workspace-${workspace.id}`} class="row-action-menu" popover="auto" role="group" aria-label={`${workspace.label} 管理菜单`} ontoggle={focusRowMenu} style={`--row-menu-left: ${rowMenuPosition.left}px; --row-menu-top: ${rowMenuPosition.top}px`}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={workspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
                title={workspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onToggleTrust(workspace.id); }}
                disabled={busy}
              >
                {#if workspace.trust === 'trusted'}<Icon name="untrust" size={14} />撤销信任{:else}<Icon name="trust" size={14} />标记为可信{/if}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={`在${workspaceLocationLabel}中打开工作区`}
                title={`在${workspaceLocationLabel}中打开`}
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onOpenWorkspaceLocation(workspace.id); }}
                disabled={busy}
              >
                <Icon name="folder" size={14} />在{workspaceLocationLabel}中打开
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label="移除工作区"
                title="移除工作区"
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onDeleteWorkspace(workspace.id); }}
                disabled={busy || archivingWorkspaceId === workspace.id}
              >
                <Icon name="delete" size={14} />移除工作区
              </Button>
              </div>
            </div>
          </div>

          {#if workspaceExpanded}
            <section
              id={`workspace-sessions-${workspace.id}`}
              class="workspace-session-group"
              aria-label={`${workspace.label} 的会话`}
              aria-busy={sessionsLoadingWorkspaceIds.includes(workspace.id)}
            >
              {#if workspaceSessions.length > 0}
                <div class="session-list" aria-label="Agent 会话列表">
                  {#each workspaceSessions as session (session.id)}
                    {@const agentLabel = session.agent === 'pi' ? 'Pi' : session.agent === 'codex' ? 'Codex' : 'Plugin'}
                    <div class:selected={session.id === selectedSessionId} class:is-renaming={renamingSessionId === session.id} class="session-item-row">
                      {#if renamingSessionId === session.id}
                        <div class="session-rename-inline">
                          <Input
                            bind:value={sessionLabelDraft}
                            aria-label="会话名称"
                            maxlength="120"
                            onkeydown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                onSaveSessionRename();
                              } else if (event.key === 'Escape') {
                                onCancelRenameSession();
                              }
                            }}
                          />
                          <Button variant="outline" size="icon" type="button" aria-label="保存会话名称" title="保存" onclick={onSaveSessionRename} disabled={busy || !sessionLabelDraft.trim()}>
                            <Icon name="check" size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" aria-label="取消改名" title="取消" onclick={onCancelRenameSession} disabled={busy}>
                            <Icon name="close" size={14} />
                          </Button>
                        </div>
                      {:else}
                        <Button
                          variant={session.id === selectedSessionId ? 'secondary' : 'ghost'}
                          type="button"
                          class="session-item"
                          aria-label={`${session.label}，${agentLabel}，${sessionStateLabel(session)}`}
                          title={`${agentLabel} · ${sessionStateLabel(session)}`}
                          onclick={() => onSelectSession(session.id)}
                          disabled={archivingSessionId === session.id}
                        >
                          <AgentStatusMark
                            icon={session.icon}
                            agent={session.agent}
                            tone={sessionStatusTone(session)}
                            label={`${agentLabel}，${sessionStateLabel(session)}`}
                          />
                          <span class="session-item-label">{session.label}</span>
                          <time class="session-updated" datetime={session.updatedAt}>
                            {archivingSessionId === session.id ? '归档中' : relativeTimeLabel(session.updatedAt)}
                          </time>
                        </Button>
                        <div class="session-item-actions" aria-label={`${session.label} 操作`}>
                          <Button variant="ghost" size="icon" type="button" aria-label={`${session.label} 更多操作`} title="更多会话操作" popovertarget={`${menuPrefix}-session-${session.id}`} onclick={event => positionRowMenu(event.currentTarget)}><span aria-hidden="true" class="row-more-mark">···</span></Button>
                          <div id={`${menuPrefix}-session-${session.id}`} class="row-action-menu" popover="auto" role="group" aria-label={`${session.label} 操作菜单`} ontoggle={focusRowMenu} style={`--row-menu-left: ${rowMenuPosition.left}px; --row-menu-top: ${rowMenuPosition.top}px`}>
                          {#if session.archived}
                            <Button variant="ghost" size="sm" type="button" aria-label="取消归档" title="取消归档" onclick={(event) => { closeRowMenu(event); onUnarchiveSession(session.id); }} disabled={busy}>
                              <Icon name="archive-restore" size={13} />取消归档
                            </Button>
                          {:else if session.canSyncSnapshot}
                            <Button variant="ghost" size="sm" type="button" aria-label="归档会话" title="归档" onclick={(event) => { closeRowMenu(event); onRequestArchiveSession(session.id); }} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                              <Icon name="archive" size={13} />归档会话
                            </Button>
                            <Button variant="ghost" size="sm" type="button" aria-label="读取线程" title="读取线程" onclick={(event) => { closeRowMenu(event); onSyncCodexThread(session.id); }} disabled={threadBusy || busy || archivingSessionId === session.id}>
                              <Icon name="refresh" size={13} />读取线程
                            </Button>
                          {:else}
                            <Button variant="ghost" size="sm" type="button" aria-label="归档会话" title="归档" onclick={(event) => { closeRowMenu(event); onRequestArchiveSession(session.id); }} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                              <Icon name="archive" size={13} />归档会话
                            </Button>
                          {/if}
                          <Button variant="ghost" size="sm" type="button" aria-label="改名" title="改名" onclick={(event) => { closeRowMenu(event); onBeginRenameSession(session.id); }} disabled={busy || archivingSessionId === session.id}>
                            <Icon name="edit" size={13} />改名
                          </Button>
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else if sessionsLoadingWorkspaceIds.includes(workspace.id)}
                <span class="session-filter-empty">加载会话…</span>
              {:else}
                <span class="session-filter-empty">{sessionSearch || sessionFilter !== 'active' ? '没有匹配的会话' : '暂无会话'}</span>
              {/if}
            </section>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  {#if footerActions}<div class="sidebar-footer">{@render footerActions()}</div>{/if}
  {#if createSessionWorkspaceId && agentWheelPosition}
    <div
      id={`session-agent-wheel-${createSessionWorkspaceId}`}
      class="session-agent-wheel"
      role="group"
      aria-label="选择 Agent 创建会话"
      style={`--agent-wheel-left: ${agentWheelPosition.left}px; --agent-wheel-top: ${agentWheelPosition.top}px; --agent-wheel-backdrop-size: ${agentWheelBackdropSize}px`}
    >
      <span class="session-agent-wheel-title">选择 Agent</span>
      <Button
        class="session-agent-wheel-trigger"
        variant="ghost"
        size="icon"
        type="button"
        aria-label="关闭 Agent 选择"
        title="关闭 Agent 选择"
        onclick={closeSessionCreator}
      >
        <Icon name="close" size={15} />
      </Button>
      {#each agentChoices as agent, index (agent.id)}
        <Button
          class="session-agent-option"
          variant="ghost"
          size="icon"
          type="button"
          style={agentWheelStyle(index)}
          aria-label={`使用 ${agent.label} 创建会话`}
          title={agent.label}
          onclick={() => onCreateAgent(createSessionWorkspaceId!, agent.id)}
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSessionCreator();
            }
          }}
          disabled={busy}
        >
          <AgentStatusMark agent="plugin" icon={agent.icon} tone="idle" label={agent.label} /><span class="session-agent-label">{agent.label}</span>
        </Button>
      {/each}
      {#if agentChoices.length === 0}
        <span class="session-agent-empty" role="status">暂无就绪的 Agent，请在扩展中安装并启用。</span>
      {/if}
    </div>
  {/if}
</Card>
