<script lang="ts">
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import ListFilterIcon from '@lucide/svelte/icons/list-filter';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import XIcon from '@lucide/svelte/icons/x';
  import { Button, Card, CardHeader, CardTitle, Input } from '$lib/ui-kit';
  import type { SessionFilter } from '$lib/types';
  import { relativeTimeLabel, sessionStateLabel, sessionStatusTone, isSessionRunning } from './session-utils';
  import type { SessionListItem, WorkspaceListItem } from './view-types';

  type WorkspaceSidebarProps = {
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
    onCreateCodex: (workspaceId: string) => void;
    onCreatePi: (workspaceId: string) => void;
    onSelectSession: (sessionId: string) => void;
    onUnarchiveSession: (sessionId: string) => void;
    onForkSession: (sessionId: string) => void;
    onRequestArchiveSession: (sessionId: string) => void;
    onCloseSession: (sessionId: string) => void;
    onSyncCodexThread: (sessionId: string) => void;
    onBeginRenameSession: (sessionId: string) => void;
    onSaveSessionRename: () => void;
    onCancelRenameSession: () => void;
  };

  let {
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
    onCreateCodex,
    onCreatePi,
    onSelectSession,
    onUnarchiveSession,
    onForkSession,
    onRequestArchiveSession,
    onCloseSession,
    onSyncCodexThread,
    onBeginRenameSession,
    onSaveSessionRename,
    onCancelRenameSession,
  }: WorkspaceSidebarProps = $props();

</script>

<Card as="aside" class="sidebar" data-ui-component="workspace-sidebar" aria-label="工作区">
  <CardHeader class="panel-heading">
    <CardTitle>工作区</CardTitle>
    <div class="workspace-toolbar" aria-label="工作区工具">
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
        <SearchIcon size={16} />
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
        <ListFilterIcon size={16} />
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
        <FolderPlusIcon size={16} />
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
        <SearchIcon size={14} />
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
          <div class:selected={workspace.id === selectedWorkspaceId} class="workspace-item-row">
            <Button
              variant={workspace.id === selectedWorkspaceId ? 'secondary' : 'ghost'}
              class="workspace-item"
              type="button"
              aria-expanded={workspaceExpanded}
              aria-controls={workspaceExpanded ? `workspace-sessions-${workspace.id}` : undefined}
              aria-label={`${workspace.label}，${workspace.trust === 'trusted' ? '可信' : '待确认'}`}
              title={workspace.path}
              onclick={() => onSelectWorkspace(workspace.id)}
            >
              {#if workspaceExpanded}
                <ChevronDownIcon class="workspace-leading-icon" size={16} />
              {:else}
                <FolderIcon class="workspace-leading-icon" size={16} />
              {/if}
              <span class="workspace-copy">
                <strong>{workspace.label}</strong>
              </span>
              <span class:trusted={workspace.trust === 'trusted'} class="trust-dot workspace-trust-dot" title={workspace.trust === 'trusted' ? '可信' : '待确认'}></span>
            </Button>
            <div class="workspace-item-actions" aria-label={`${workspace.label} 管理操作`}>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="新建 Agent 会话"
                title="新建会话"
                onclick={(event) => { event.stopPropagation(); onToggleSessionCreator(workspace.id); }}
                disabled={busy}
              >
                <PlusIcon size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={workspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
                title={workspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
                onclick={(event) => { event.stopPropagation(); onToggleTrust(workspace.id); }}
                disabled={busy}
              >
                {#if workspace.trust === 'trusted'}<ShieldOffIcon size={14} />{:else}<ShieldCheckIcon size={14} />{/if}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="移除工作区"
                title="移除工作区"
                onclick={(event) => { event.stopPropagation(); onDeleteWorkspace(workspace.id); }}
                disabled={busy || archivingWorkspaceId === workspace.id}
              >
                <Trash2Icon size={14} />
              </Button>
            </div>
          </div>

          {#if workspaceExpanded}
            <section id={`workspace-sessions-${workspace.id}`} class="workspace-session-group" aria-label={`${workspace.label} 的会话`}>
              {#if createSessionWorkspaceId === workspace.id}
                <div class="session-create-actions" aria-label="选择 Agent">
                  <Button size="sm" type="button" onclick={() => onCreateCodex(workspace.id)} disabled={busy}>Codex</Button>
                  <Button variant="outline" size="sm" type="button" onclick={() => onCreatePi(workspace.id)} disabled={busy}>Pi</Button>
                </div>
              {/if}
              {#if sessionsLoadingWorkspaceIds.includes(workspace.id)}
                <span class="session-filter-empty">加载会话…</span>
              {:else if workspaceSessions.length > 0}
                <div class="session-list" aria-label="Agent 会话列表">
                  {#each workspaceSessions as session (session.id)}
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
                            <CheckIcon size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" type="button" aria-label="取消改名" title="取消" onclick={onCancelRenameSession} disabled={busy}>
                            <XIcon size={14} />
                          </Button>
                        </div>
                      {:else}
                        <Button
                          variant={session.id === selectedSessionId ? 'secondary' : 'ghost'}
                          type="button"
                          class="session-item"
                          aria-label={`${session.label}，${session.agent === 'pi' ? 'Pi' : 'Codex'}，${sessionStateLabel(session)}`}
                          title={`${session.agent === 'pi' ? 'Pi' : 'Codex'} · ${sessionStateLabel(session)}`}
                          onclick={() => onSelectSession(session.id)}
                          disabled={archivingSessionId === session.id}
                        >
                          <span class={`session-state-dot ${sessionStatusTone(session)}`} aria-hidden="true"></span>
                          <span class="session-item-label">{session.label}</span>
                          <time class="session-updated" datetime={session.updatedAt}>
                            {archivingSessionId === session.id ? '归档中' : relativeTimeLabel(session.updatedAt)}
                          </time>
                        </Button>
                        <div class="session-item-actions" aria-label={`${session.label} 操作`}>
                          {#if session.archived}
                            <Button variant="ghost" size="icon" type="button" aria-label="取消归档" title="取消归档" onclick={() => onUnarchiveSession(session.id)} disabled={busy}>
                              <ArchiveRestoreIcon size={13} />
                            </Button>
                          {:else if session.agent === 'codex'}
                            <Button variant="ghost" size="icon" type="button" aria-label="创建分支" title="分支" onclick={() => onForkSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                              <GitBranchIcon size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" type="button" aria-label="归档会话" title="归档" onclick={() => onRequestArchiveSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                              <ArchiveIcon size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" type="button" aria-label="关闭会话" title="关闭" onclick={() => onCloseSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                              <XIcon size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" type="button" aria-label="读取线程" title="读取线程" onclick={() => onSyncCodexThread(session.id)} disabled={threadBusy || busy || archivingSessionId === session.id}>
                              <RefreshCwIcon size={13} />
                            </Button>
                          {:else}
                            <Button variant="ghost" size="icon" type="button" aria-label="归档会话" title="归档" onclick={() => onRequestArchiveSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                              <ArchiveIcon size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" type="button" aria-label="关闭会话" title="关闭" onclick={() => onCloseSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                              <XIcon size={13} />
                            </Button>
                          {/if}
                          <Button variant="ghost" size="icon" type="button" aria-label="改名" title="改名" onclick={() => onBeginRenameSession(session.id)} disabled={busy || archivingSessionId === session.id}>
                            <PencilIcon size={13} />
                          </Button>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <span class="session-filter-empty">{sessionSearch || sessionFilter !== 'active' ? '没有匹配的会话' : '暂无会话'}</span>
              {/if}
            </section>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</Card>
