<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import { tick, type Snippet } from 'svelte';
  import { Select, AgentStatusMark, Button, Card, CardHeader, CardTitle, Icon, Input, Separator } from '$lib/ui-kit';
  import type { SessionFilter } from '$lib/types';
  import { relativeTimeLabel, sessionStateLabel, sessionStatusTone, isSessionRunning } from './session-utils';
  import type { SessionListItem, WorkspaceListItem } from './view-types';
  import type { SessionProviderChoice } from '$lib/app/session-providers';
  import { WORKSPACE_SESSION_PAGE_SIZE } from '$lib/app/session-transitions';

  type WorkspaceSidebarProps = {
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    presentationActions?: Snippet;
    footerActions?: Snippet;
    workspaces: WorkspaceListItem[];
    sessionsByWorkspace: Record<string, SessionListItem[]>;
    sessionVisibleCounts?: Record<string, number>;
    onLoadMoreSessions: (workspaceId: string) => void;
    selectedWorkspaceId: string | null;
    expandedWorkspaceIds: string[];
    selectedSessionId: string | null;
    sessionsLoadingWorkspaceIds: string[];
    busy: boolean;
    threadBusy: boolean;
    archivingWorkspaceId: string | null;
    archivingSessionId: string | null;
    sessionFilterOpen: boolean;
    sessionFilter?: SessionFilter;
    createSessionWorkspaceId: string | null;
    renamingSessionId: string | null;
    sessionLabelDraft?: string;
    onToggleFilter: () => void;
    onApplyFilters: () => void;
    onChooseWorkspaceDirectory: () => void;
    onSelectWorkspace: (workspaceId: string) => void;
    onToggleSessionCreator: (workspaceId: string) => void;
    onToggleTrust: (workspaceId: string) => void;
    onDeleteWorkspace: (workspaceId: string) => void;
    onOpenWorkspaceLocation: (workspaceId: string) => void;
    agentChoices: (SessionProviderChoice & { unavailableReason?: string })[];
    onCreateAgent: (workspaceId: string, choiceId: string) => void;
    onSelectSession: (sessionId: string) => void;
    onUnarchiveSession: (sessionId: string) => void;
    onRequestArchiveSession: (sessionId: string) => void;
    onSyncCodexThread: (sessionId: string) => void;
    onBeginRenameSession: (sessionId: string) => void;
    onSaveSessionRename: () => void;
    onCancelRenameSession: () => void;
    onOpenPlugins?: () => void;
  };

  let {
    collapsed = false,
    onToggleCollapsed,
    presentationActions,
    footerActions,
    workspaces,
    sessionsByWorkspace,
    sessionVisibleCounts = {},
    onLoadMoreSessions,
    selectedWorkspaceId,
    expandedWorkspaceIds,
    selectedSessionId,
    sessionsLoadingWorkspaceIds,
    busy,
    threadBusy,
    archivingWorkspaceId,
    archivingSessionId,
    sessionFilterOpen,
    sessionFilter = $bindable<SessionFilter>('active'),
    createSessionWorkspaceId,
    renamingSessionId,
    sessionLabelDraft = $bindable(''),
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
    onOpenPlugins,
  }: WorkspaceSidebarProps = $props();
  const workspaceLocationLabel = $derived(navigator.platform.startsWith('Mac')
    ? 'Finder'
    : navigator.platform.startsWith('Win')
      ? $t('sidebar.fileExplorer')
      : $t('sidebar.fileManager'));
  const agentLaunchers = new Map<string, HTMLElement>();
  let primaryLauncher: HTMLElement | null = null;
  const menuPrefix = $props.id();
  let rowMenuPosition = $state({ left: 0, top: 0 });
  function positionRowMenu(trigger: HTMLButtonElement) {
    const bounds = trigger.getBoundingClientRect();
    rowMenuPosition = { left: bounds.right - 240, top: bounds.bottom + 4 };
  }
  function closeRowMenu(event: MouseEvent) {
    (event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover();
  }
  function focusRowMenu(event: ToggleEvent) {
    if (event.newState === 'open') (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  let agentWheelPosition = $state<{ left: number; top: number } | null>(null);
  let agentMenu: HTMLDivElement | null = $state(null);
  const sessionCreatorWorkspaceLabel = $derived(workspaces.find(workspace => workspace.id === createSessionWorkspaceId)?.label ?? $t('settings.workspace'));

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
    const menuHeight = agentMenu?.offsetHeight ?? 0;
    agentWheelPosition = {
      left: bounds.left,
      top: bounds.bottom + 4 + menuHeight > window.innerHeight - 12
        ? Math.max(12, bounds.top - menuHeight - 4)
        : bounds.bottom + 4,
    };
  }

  $effect(() => {
    const openWorkspaceId = createSessionWorkspaceId;
    const frame = requestAnimationFrame(() => {
      updateAgentWheelPosition();
      if (openWorkspaceId) void tick().then(() => {
        if (createSessionWorkspaceId !== openWorkspaceId) return;
        updateAgentWheelPosition();
        (agentMenu?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? agentMenu)?.focus();
      });
    });
    window.addEventListener('resize', updateAgentWheelPosition);
    document.addEventListener('scroll', updateAgentWheelPosition, true);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!openWorkspaceId || !(event.target instanceof Element)) return;
      if (event.target.closest('.session-agent-wheel, .session-agent-launcher, .sidebar-new-session')) return;
      onToggleSessionCreator(openWorkspaceId);
    };
    const handleCreatorKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !openWorkspaceId) return;
      if (event.key === 'Escape') {
        event.preventDefault(); closeSessionCreator();
      } else if (event.target instanceof Node && agentMenu?.contains(event.target)) {
        handleAgentMenuKeydown(event);
      }
    };
    if (openWorkspaceId) document.addEventListener('keydown', handleCreatorKeydown);
    if (openWorkspaceId) document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateAgentWheelPosition);
      document.removeEventListener('scroll', updateAgentWheelPosition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', handleCreatorKeydown);
    };
  });

  function closeSessionCreator(): void {
    const workspaceId = createSessionWorkspaceId;
    if (!workspaceId) return;
    const trigger = primaryLauncher ?? agentLaunchers.get(workspaceId)?.querySelector<HTMLElement>('button');
    onToggleSessionCreator(workspaceId);
    void tick().then(() => trigger?.focus());
  }

  function handleAgentMenuKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const buttons = Array.from(agentMenu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (buttons.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (/^[1-9]$/.test(event.key)) {
      const agent = agentChoices[Number(event.key) - 1];
      if (!agent || agent.unavailableReason || busy || !createSessionWorkspaceId) return;
      event.preventDefault();
      onCreateAgent(createSessionWorkspaceId, agent.id);
    }
  }


</script>

<Card as="aside" class={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'} data-ui-component="workspace-sidebar" aria-label={$t('settings.workspace')}>
  <div class="sidebar-primary-actions">
    <Button class="sidebar-toggle" variant="ghost" size="icon" aria-label={collapsed ? $t('sidebar.expand') : $t('sidebar.collapse')} title={collapsed ? $t('sidebar.expand') : $t('sidebar.collapse')} aria-expanded={!collapsed} onclick={onToggleCollapsed}><Icon name="panel-left" size={20} /></Button>
    <Button aria-label={$t('commands.new')} title={$t('commands.new') + ' · ' + (workspaces.find(workspace => workspace.id === selectedWorkspaceId)?.label ?? workspaces[0]?.label ?? $t('sidebar.addWorkspace'))} class="sidebar-new-session" type="button" disabled={busy}
      aria-expanded={Boolean(createSessionWorkspaceId)}
      aria-controls={createSessionWorkspaceId ? `session-agent-wheel-${createSessionWorkspaceId}` : undefined}
      onclick={(event) => {
        const workspaceId = selectedWorkspaceId ?? workspaces[0]?.id;
        if (!workspaceId) { onChooseWorkspaceDirectory(); return; }
        primaryLauncher = event.currentTarget;
        onToggleSessionCreator(workspaceId);
      }}><Icon name="add" size={16} /><span>{$t('commands.new')}</span></Button>
  </div>
  {#if collapsed}
    {@const waiting = Object.values(sessionsByWorkspace).flat().filter(session => !session.archived && ['waiting_approval', 'waiting_user'].includes(session.state)).length}
    <Button class="sidebar-browse" variant="ghost" size="icon" aria-label={waiting ? $t('sidebar.waiting', { count: waiting }) : $t('sidebar.browse')} title={waiting ? $t('sidebar.waitingHint', { count: waiting }) : $t('sidebar.browse')} onclick={onToggleCollapsed}><Icon name="folder" size={20} />{#if waiting}<span class="sidebar-attention" aria-hidden="true"></span>{/if}</Button>
  {/if}
  <CardHeader class="panel-heading">
    <CardTitle>{$t('settings.workspace')}</CardTitle>
    <div class="workspace-toolbar" aria-label={$t('sidebar.workspaceTools')}>
          {@render presentationActions?.()}
      <Button
        variant="ghost"
        size="icon"
        type="button"
        class={sessionFilterOpen || sessionFilter !== 'active' ? 'active' : undefined}
        aria-label={$t('sidebar.filter')}
        title={$t('sidebar.filter')}
        aria-pressed={sessionFilterOpen}
        onclick={onToggleFilter}
      >
        <Icon name="filter" size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={$t('sidebar.addWorkspace')}
        title={$t('sidebar.addWorkspace')}
        onclick={onChooseWorkspaceDirectory}
        disabled={busy}
      >
        <Icon name="folder-add" size={16} />
      </Button>
    </div>
  </CardHeader>

  {#if sessionFilterOpen}
    <form
      class="workspace-tool-panel session-filter-form"
      aria-label={$t('sidebar.searchFilter')}
      onsubmit={(event) => {
        event.preventDefault();
        onApplyFilters();
      }}
    >
      {#if sessionFilterOpen}
        <Select class="session-filter-select" aria-label={$t('sidebar.statusFilter')} value={sessionFilter}
          options={[{value:'active',label:$t('sidebar.active')},{value:'all',label:$t('sidebar.all')},{value:'archived',label:$t('session.status.archived')},{value:'running',label:$t('session.status.running')},{value:'waiting_approval',label:$t('session.status.waiting_approval')},{value:'idle',label:$t('session.status.idle')},{value:'interrupted',label:$t('session.status.interrupted')},{value:'failed',label:$t('session.status.failed')},{value:'closed',label:$t('session.status.closed')}]}
          onSelect={value => { sessionFilter = value as typeof sessionFilter; onApplyFilters(); }} />
      {/if}
      <Button variant="ghost" size="icon" type="submit" aria-label={$t('sidebar.applyFilter')} disabled={!selectedWorkspaceId}>
        <Icon name="filter" size={14} />
      </Button>
    </form>
  {/if}

  <div class="workspace-list" aria-label={$t('sidebar.workspaces')}>
    {#if workspaces.length === 0}
      <div class="empty-list">{$t('sidebar.emptyWorkspaces')}</div>
    {:else}
      {#each workspaces as workspace (workspace.id)}
        {@const workspaceExpanded = expandedWorkspaceIds.includes(workspace.id)}
        {@const workspaceSessions = sessionsByWorkspace[workspace.id] ?? []}
        {@const visibleCount = sessionVisibleCounts[workspace.id] ?? WORKSPACE_SESSION_PAGE_SIZE}
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
              aria-label={$t('sidebar.workspaceStatus', { name: workspace.label, status: workspace.trust === 'trusted' ? $t('sidebar.trusted') : $t('sidebar.untrusted') })}
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
            </Button>
            <div class="workspace-item-actions" use:registerAgentLauncher={workspace.id} aria-label={$t('sidebar.workspaceActions', { name: workspace.label })}>
              <Button variant="ghost" size="icon" type="button" aria-label={$t('sidebar.moreActions', { name: workspace.label })} title={$t('sidebar.moreWorkspaceActions')} popovertarget={`${menuPrefix}-workspace-${workspace.id}`} onclick={event => positionRowMenu(event.currentTarget)}><Icon name="more" size={18} /></Button>
              <div id={`${menuPrefix}-workspace-${workspace.id}`} class="row-action-menu" popover="auto" role="group" aria-label={$t('sidebar.workspaceMenu', { name: workspace.label })} ontoggle={focusRowMenu} style={`--row-menu-left: ${rowMenuPosition.left}px; --row-menu-top: ${rowMenuPosition.top}px`}>
              <Button variant="ghost" size="sm" disabled={busy} onclick={(event) => { event.stopPropagation(); closeRowMenu(event); primaryLauncher = agentLaunchers.get(workspace.id)?.querySelector<HTMLButtonElement>('button') ?? null; onToggleSessionCreator(workspace.id); }}><Icon name="add" size={18} />{$t('sidebar.createHere')}</Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={$t('sidebar.openWorkspaceLocation', { location: workspaceLocationLabel })}
                title={$t('sidebar.openLocation', { location: workspaceLocationLabel })}
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onOpenWorkspaceLocation(workspace.id); }}
                disabled={busy}
              >
                <Icon name="folder" size={18} />{$t('sidebar.openLocation', { location: workspaceLocationLabel })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={workspace.trust === 'trusted' ? $t('sidebar.revokeTrust') : $t('sidebar.markTrusted')}
                title={workspace.trust === 'trusted' ? $t('sidebar.revokeTrust') : $t('sidebar.markTrusted')}
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onToggleTrust(workspace.id); }}
                disabled={busy}
              >
                {#if workspace.trust === 'trusted'}<Icon name="untrust" size={18} />{$t('sidebar.revokeTrust')}{:else}<Icon name="trust" size={18} />{$t('sidebar.markTrusted')}{/if}
              </Button>
              <Separator />
              <Button
                variant="ghost"
                class="row-action-danger"
                size="sm"
                type="button"
                aria-label={$t('sidebar.removeWorkspace')}
                title={$t('sidebar.removeWorkspace')}
                onclick={(event) => { event.stopPropagation(); closeRowMenu(event); onDeleteWorkspace(workspace.id); }}
                disabled={busy || archivingWorkspaceId === workspace.id}
              >
                <Icon name="delete" size={18} />{$t('sidebar.removeWorkspace')}
              </Button>
              </div>
            </div>
          </div>

          {#if workspaceExpanded}
            <section
              id={`workspace-sessions-${workspace.id}`}
              class="workspace-session-group"
              aria-label={$t('sidebar.workspaceSessions', { name: workspace.label })}
              aria-busy={sessionsLoadingWorkspaceIds.includes(workspace.id)}
            >
              {#if workspaceSessions.length > 0}
                <div class="session-list" aria-label={$t('sidebar.agentSessions')}>
                  {#each workspaceSessions.slice(0, visibleCount) as session (session.id)}
                    {@const agentLabel = session.providerLabel ?? 'Agent'}
                    <div class:selected={session.id === selectedSessionId} class:is-renaming={renamingSessionId === session.id} class="session-item-row">
                      {#if renamingSessionId === session.id}
                        <div class="session-rename-inline">
                          <Input
                            bind:value={sessionLabelDraft}
                            aria-label={$t('sidebar.sessionName')}
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
                          <Button variant="outline" size="icon" type="button" aria-label={$t('sidebar.saveName')} title={$t('common.save')} onclick={onSaveSessionRename} disabled={busy || !sessionLabelDraft.trim()}>
                            <Icon name="check" size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" aria-label={$t('sidebar.cancelRename')} title={$t('common.cancel')} onclick={onCancelRenameSession} disabled={busy}>
                            <Icon name="close" size={14} />
                          </Button>
                        </div>
                      {:else}
                        <Button
                          variant={session.id === selectedSessionId ? 'secondary' : 'ghost'}
                          type="button"
                          class="session-item"
                          aria-label={`${session.label}，${agentLabel}，${sessionStateLabel(session, $locale)}`}
                          title={`${agentLabel} · ${sessionStateLabel(session, $locale)}`}
                          onclick={() => onSelectSession(session.id)}
                          disabled={archivingSessionId === session.id}
                        >
                          <AgentStatusMark
                            icon={session.icon}
                            agent={session.agent}
                            tone={sessionStatusTone(session)}
                            label={`${agentLabel}，${sessionStateLabel(session, $locale)}`}
                          />
                          <span class="session-item-label">{session.label}</span>
                          {#if !session.archived && ['waiting_approval', 'waiting_user', 'failed', 'interrupted'].includes(session.state)}
                            <span class="session-state-label" data-tone={sessionStatusTone(session)}>{sessionStateLabel(session, $locale)}</span>
                          {:else}
                          <time class="session-updated" datetime={session.updatedAt}>
                            {archivingSessionId === session.id ? $t('sidebar.archiving') : relativeTimeLabel(session.updatedAt, $locale)}
                          </time>
                          {/if}
                        </Button>
                        <div class="session-item-actions" aria-label={$t('sidebar.sessionActions', { name: session.label })}>
                          <Button variant="ghost" size="icon" type="button" aria-label={$t('sidebar.moreActions', { name: session.label })} title={$t('sidebar.moreSessionActions')} popovertarget={`${menuPrefix}-session-${session.id}`} onclick={event => positionRowMenu(event.currentTarget)}><Icon name="more" size={18} /></Button>
                          <div id={`${menuPrefix}-session-${session.id}`} class="row-action-menu" popover="auto" role="group" aria-label={$t('sidebar.sessionMenu', { name: session.label })} ontoggle={focusRowMenu} style={`--row-menu-left: ${rowMenuPosition.left}px; --row-menu-top: ${rowMenuPosition.top}px`}>
                          <Button variant="ghost" size="sm" type="button" aria-label={$t('sidebar.rename')} title={$t('sidebar.rename')} onclick={(event) => { closeRowMenu(event); onBeginRenameSession(session.id); }} disabled={busy || archivingSessionId === session.id}>
                            <Icon name="edit" size={18} />{$t('sidebar.rename')}
                          </Button>
                          {#if !session.archived && session.canSyncSnapshot}
                            <Button variant="ghost" size="sm" type="button" aria-label={$t('sidebar.readThread')} title={$t('sidebar.readThread')} onclick={(event) => { closeRowMenu(event); onSyncCodexThread(session.id); }} disabled={threadBusy || busy || archivingSessionId === session.id}>
                              <Icon name="refresh" size={18} />{$t('sidebar.readThread')}
                            </Button>
                          {/if}
                          <Separator />
                          {#if session.archived}
                            <Button variant="ghost" size="sm" type="button" aria-label={$t('sidebar.unarchive')} title={$t('sidebar.unarchive')} onclick={(event) => { closeRowMenu(event); onUnarchiveSession(session.id); }} disabled={busy}>
                              <Icon name="archive-restore" size={18} />{$t('sidebar.unarchive')}
                            </Button>
                          {:else}
                            <Button variant="ghost" size="sm" type="button" aria-label={$t('commands.archive')} title={$t('sidebar.archiveHint')} onclick={(event) => { closeRowMenu(event); onRequestArchiveSession(session.id); }} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                              <Icon name="archive" size={18} />{$t('sidebar.archive')}
                            </Button>
                          {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                  {#if workspaceSessions.length > visibleCount}
                    <Button variant="ghost" type="button" onclick={() => onLoadMoreSessions(workspace.id)}>
                      {$t('sidebar.loadMore')}
                    </Button>
                  {/if}
                </div>
              {:else if sessionsLoadingWorkspaceIds.includes(workspace.id)}
                <span class="session-filter-empty">{$t('sidebar.loading')}</span>
              {:else}
                <span class="session-filter-empty">{sessionFilter !== 'active' ? $t('sidebar.noMatches') : $t('sidebar.noSessions')}</span>
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
      bind:this={agentMenu}
      id={`session-agent-wheel-${createSessionWorkspaceId}`}
      class="session-agent-wheel"
      role="group"
      aria-label={$t('sidebar.selectAgent')}
      tabindex="-1"
      style={`--agent-wheel-left: ${agentWheelPosition.left}px; --agent-wheel-top: ${agentWheelPosition.top}px`}
    >
      <span class="session-agent-wheel-title" title={$t('sidebar.createInWorkspace', { name: sessionCreatorWorkspaceLabel })}>{$t('sidebar.createInWorkspace', { name: sessionCreatorWorkspaceLabel })}</span>
      {#each agentChoices as agent, index (agent.id)}
        <Button
          class="session-agent-option"
          variant="ghost"
          size="sm"
          type="button"
          aria-label={$t('sidebar.createWithAgent', { name: agent.label })}
          aria-keyshortcuts={!busy && !agent.unavailableReason && index < 9 ? String(index + 1) : undefined}
          title={`${agent.label} · ${agent.unavailableReason ?? $t('sidebar.ready')}`}
          onclick={() => onCreateAgent(createSessionWorkspaceId!, agent.id)}
          onkeydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSessionCreator();
            }
          }}
          disabled={busy || Boolean(agent.unavailableReason)}
        >
          <AgentStatusMark agent="plugin" icon={agent.icon} tone="idle" label={agent.label} /><span class="session-agent-label">{agent.label}<small>{agent.unavailableReason ?? $t('sidebar.ready')}</small></span>
          {#if !agent.unavailableReason && index < 9}<kbd class="session-agent-shortcut">{index + 1}</kbd>{/if}
        </Button>
      {/each}
      {#if agentChoices.length === 0}
        <span class="session-agent-empty" role="status">{$t('sidebar.noAgents')}</span>
        {#if onOpenPlugins}
          <Button variant="outline" size="sm" class="session-agent-empty-action" onclick={() => { closeSessionCreator(); void tick().then(onOpenPlugins); }}>
            <Icon name="plugins" size={15} />{$t('sidebar.openPlugins')}
          </Button>
        {/if}
      {/if}
    </div>
  {/if}
</Card>
