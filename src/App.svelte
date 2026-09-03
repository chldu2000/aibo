<script lang="ts">
  import { onMount } from 'svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SendIcon from '@lucide/svelte/icons/send';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import SquareIcon from '@lucide/svelte/icons/square';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    addWorkspace,
    abortCodexTurn,
    closeCodexSession,
    createCodexSession,
    getTimeline,
    isTauri,
    listWorkspaces,
    listSessions,
    listenToAgentEvents,
    probeAgents,
    removeWorkspace,
    sendCodexPrompt,
    setWorkspaceTrust,
  } from './lib/api';
  import type { AgentDiagnostic, AgentEvent, Session, TimelineItem, Workspace } from './lib/types';

  const previewWorkspaces: Workspace[] = [
    {
      id: 'preview-workspace',
      path: '/Users/you/Workspace/example',
      label: 'example',
      trust: 'untrusted',
      lastOpenedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const previewDiagnostics: AgentDiagnostic[] = [
    {
      agent: 'codex',
      label: 'Codex',
      status: 'ready',
      executable: '/usr/local/bin/codex',
      version: 'detected at runtime',
      capabilities: ['app-server', 'streaming', 'approval'],
      authState: 'delegated',
      message: 'Web preview; desktop mode probes the local installation.',
    },
    {
      agent: 'pi',
      label: 'Pi',
      status: 'ready',
      executable: null,
      version: 'SDK 0.84.4',
      capabilities: ['sdk-host', 'streaming', 'abort', 'session-tree'],
      authState: 'delegated',
      message: 'Project-locked SDK host; native authentication remains with Pi.',
    },
  ];

  let workspaces = $state<Workspace[]>([]);
  let diagnostics = $state<AgentDiagnostic[]>([]);
  let sessions = $state<Session[]>([]);
  let timeline = $state<TimelineItem[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedSessionId = $state<string | null>(null);
  let workspacePath = $state('');
  let composerText = $state('');
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let desktop = $state(false);

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const selectedSession = $derived(
    sessions.find((session) => session.id === selectedSessionId) ?? null,
  );

  const readyAgents = $derived(diagnostics.filter((agent) => agent.status === 'ready').length);
  const sessionRunning = $derived(
    selectedSession?.state === 'running' || selectedSession?.state === 'waiting_approval',
  );

  onMount(() => {
    let stopListening: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      desktop = isTauri();
      if (!desktop) {
        workspaces = previewWorkspaces;
        diagnostics = previewDiagnostics;
        selectedWorkspaceId = previewWorkspaces[0]?.id ?? null;
        return;
      }

      const unlisten = await listenToAgentEvents(handleAgentEvent);
      if (disposed) {
        unlisten();
        return;
      }
      stopListening = unlisten;
      await refresh();
    })();

    return () => {
      disposed = true;
      stopListening?.();
    };
  });

  async function refresh() {
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中刷新本机诊断。';
      return;
    }
    busy = true;
    errorMessage = null;
    try {
      const [loadedWorkspaces, loadedDiagnostics] = await Promise.all([
        listWorkspaces(),
        probeAgents(),
      ]);
      workspaces = loadedWorkspaces;
      diagnostics = loadedDiagnostics;
      selectedWorkspaceId =
        selectedWorkspaceId && loadedWorkspaces.some(({ id }) => id === selectedWorkspaceId)
          ? selectedWorkspaceId
          : (loadedWorkspaces[0]?.id ?? null);
      const activeWorkspaceId = selectedWorkspaceId;
      if (activeWorkspaceId) {
        await refreshSessions(activeWorkspaceId);
      } else {
        sessions = [];
        timeline = [];
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function refreshSessions(workspaceId: string) {
    const loadedSessions = await listSessions(workspaceId);
    if (workspaceId !== selectedWorkspaceId) return;
    sessions = loadedSessions;
    selectedSessionId =
      selectedSessionId && loadedSessions.some(({ id }) => id === selectedSessionId)
        ? selectedSessionId
        : (loadedSessions[0]?.id ?? null);
    if (selectedSessionId) {
      await refreshTimeline(selectedSessionId);
    } else {
      timeline = [];
    }
  }

  async function refreshTimeline(sessionId: string) {
    const loadedTimeline = await getTimeline(sessionId);
    if (sessionId === selectedSessionId) timeline = loadedTimeline;
  }

  function handleAgentEvent(event: AgentEvent) {
    if (event.workspaceId !== selectedWorkspaceId) return;

    const state = event.type === 'session.state_changed' ? event.payload.state : undefined;
    if (typeof state === 'string') {
      sessions = sessions.map((session) =>
        session.id === event.sessionId ? { ...session, state: state as Session['state'] } : session,
      );
    }

    if (event.sessionId === selectedSessionId && event.type === 'message.delta') {
      const externalMessageId = stringPayload(event.payload.itemId) ?? `delta:${event.eventId}`;
      const delta = stringPayload(event.payload.delta) ?? '';
      const existing = timeline.find((item) => item.externalMessageId === externalMessageId);
      if (existing) {
        timeline = timeline.map((item) =>
          item.id === existing.id
            ? { ...item, content: item.content + delta, status: 'streaming', updatedAt: event.occurredAt }
            : item,
        );
      } else {
        timeline = [
          ...timeline,
          {
            id: `live:${event.eventId}`,
            sessionId: event.sessionId,
            turnId: event.turnId,
            externalMessageId,
            role: 'assistant',
            content: delta,
            status: 'streaming',
            createdAt: event.occurredAt,
            updatedAt: event.occurredAt,
          },
        ];
      }
    }

    if (event.type === 'message.completed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
      void refreshSessions(event.workspaceId);
    }
  }

  function stringPayload(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  async function createWorkspace() {
    const path = workspacePath.trim();
    if (!path) {
      errorMessage = '请输入一个已经存在的本地目录。';
      return;
    }

    if (!desktop) {
      notice = '当前是 Web 预览；工作区变更需要在 Tauri 桌面模式中保存。';
      return;
    }

    busy = true;
    errorMessage = null;
    notice = null;
    try {
      const workspace = await addWorkspace(path);
      workspaces = [workspace, ...workspaces.filter(({ id }) => id !== workspace.id)];
      selectedWorkspaceId = workspace.id;
      workspacePath = '';
      notice = '工作区已添加。首次运行 Agent 前请明确确认信任状态。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function createCodex() {
    if (!selectedWorkspace) {
      errorMessage = '请先选择一个工作区。';
      return;
    }
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中启动 Codex。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      const session = await createCodexSession(selectedWorkspace.id);
      sessions = [session, ...sessions.filter(({ id }) => id !== session.id)];
      selectedSessionId = session.id;
      timeline = [];
      notice = 'Codex 会话已启动，可以发送第一条消息。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function sendPrompt() {
    const input = composerText.trim();
    if (!input) return;
    if (!selectedWorkspace) {
      errorMessage = '请先选择一个工作区。';
      return;
    }
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中发送真实 Codex 请求。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      let session = selectedSession;
      if (!session) {
        session = await createCodexSession(selectedWorkspace.id);
        sessions = [session, ...sessions.filter(({ id }) => id !== session.id)];
        selectedSessionId = session.id;
      }
      await sendCodexPrompt(session.id, input);
      await refreshTimeline(session.id);
      composerText = '';
      sessions = sessions.map((item) =>
        item.id === session?.id ? { ...item, state: 'running' } : item,
      );
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function abortPrompt() {
    if (!selectedSession || !desktop) return;
    busy = true;
    errorMessage = null;
    try {
      await abortCodexTurn(selectedSession.id);
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function closeSession() {
    if (!selectedSession || !desktop) return;
    busy = true;
    errorMessage = null;
    try {
      const closingId = selectedSession.id;
      await closeCodexSession(closingId);
      const remaining = sessions.filter(({ id }) => id !== closingId);
      sessions = remaining;
      selectedSessionId = remaining[0]?.id ?? null;
      timeline = selectedSessionId ? await getTimeline(selectedSessionId) : [];
      notice = 'Codex 会话已关闭；已保存的时间线仍可在下次启动时读取。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function selectSession(id: string) {
    selectedSessionId = id;
    if (desktop) void refreshTimeline(id);
  }

  async function toggleTrust(workspace: Workspace) {
    if (!desktop) {
      notice = '当前是 Web 预览；信任状态只会在 Tauri 桌面模式中写入。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      const updated = await setWorkspaceTrust(workspace.id, workspace.trust !== 'trusted');
      workspaces = workspaces.map((item) => (item.id === updated.id ? updated : item));
      notice = updated.trust === 'trusted' ? '工作区已标记为可信。' : '工作区已撤销信任。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function deleteWorkspace(workspace: Workspace) {
    if (!desktop) {
      notice = '当前是 Web 预览；删除操作需要在 Tauri 桌面模式中执行。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      await removeWorkspace(workspace.id);
      workspaces = workspaces.filter(({ id }) => id !== workspace.id);
      selectedWorkspaceId = workspaces[0]?.id ?? null;
      sessions = [];
      timeline = [];
      if (selectedWorkspaceId) void refreshSessions(selectedWorkspaceId);
      notice = '工作区已从 Aibo 移除；本地目录未被删除。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function selectWorkspace(id: string) {
    selectedWorkspaceId = id;
    selectedSessionId = null;
    sessions = [];
    timeline = [];
    if (desktop) void refreshSessions(id);
    notice = null;
  }

  function toErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return '操作失败，请查看诊断日志。';
  }
</script>

<svelte:head>
  <title>Aibo · Local Agent Workbench</title>
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div class="topbar-context">
      <span class="topbar-title">工作区</span>
      {#if selectedWorkspace}<span class="topbar-path">{selectedWorkspace.label}</span>{/if}
    </div>
    <div class="topbar-meta">
      <Badge variant={desktop ? 'success' : 'outline'}>{desktop ? 'macOS' : 'Web 预览'}</Badge>
      <span class="connection"><span class="status-dot"></span> 就绪</span>
    </div>
  </header>

  <main class="workspace-grid">
    <Card as="aside" class="sidebar" aria-label="工作区">
      <CardHeader class="panel-heading">
        <CardTitle>工作区</CardTitle>
        <Badge variant="secondary" class="count-pill">{workspaces.length}</Badge>
      </CardHeader>

      <form class="workspace-form" onsubmit={(event) => { event.preventDefault(); void createWorkspace(); }}>
        <Label class="mb-2 block" for="workspace-path">添加本地目录</Label>
        <div class="input-row">
          <Input id="workspace-path" bind:value={workspacePath} placeholder="/Users/you/Workspace/project" autocomplete="off" />
          <Button size="icon" type="submit" aria-label="添加工作区" disabled={busy}>
            <PlusIcon size={15} strokeWidth={2.25} />
          </Button>
        </div>
      </form>
      <Separator />

      <div class="workspace-list" aria-label="工作区列表">
        {#if workspaces.length === 0}
          <div class="empty-list">暂无工作区</div>
        {:else}
          {#each workspaces as workspace (workspace.id)}
            <Button
              variant={workspace.id === selectedWorkspaceId ? 'secondary' : 'ghost'}
              class="workspace-item"
              type="button"
              onclick={() => selectWorkspace(workspace.id)}
            >
              <span class="workspace-copy">
                <strong>{workspace.label}</strong>
                <small>{workspace.path}</small>
              </span>
              <span class:trusted={workspace.trust === 'trusted'} class="trust-dot" title={workspace.trust}></span>
            </Button>
          {/each}
        {/if}
      </div>

      <div class="sidebar-footer">
        <span class="legend"><span class="trust-dot trusted"></span> 可信</span>
        <span class="legend"><span class="trust-dot"></span> 待确认</span>
      </div>
    </Card>

    <Card as="section" class="timeline" aria-label="会话时间线">
      <CardHeader class="panel-heading timeline-heading">
        <CardTitle>{selectedSession?.label ?? selectedWorkspace?.label ?? '选择工作区'}</CardTitle>
        <div class="timeline-heading-actions">
          {#if selectedSession}
            <Badge variant={sessionRunning ? 'warning' : 'outline'}>{selectedSession.state}</Badge>
          {/if}
          {#if selectedWorkspace}
            <Badge variant={selectedWorkspace.trust === 'trusted' ? 'success' : 'warning'}>
              {selectedWorkspace.trust === 'trusted' ? '可信' : '待确认'}
            </Badge>
          {/if}
        </div>
      </CardHeader>
      <Separator />

      {#if selectedWorkspace}
        <div class="session-toolbar">
          <Button size="sm" type="button" onclick={() => void createCodex()} disabled={busy}>
            <PlusIcon size={14} /> 新建会话
          </Button>
          {#if selectedSession}
            <Button variant="ghost" size="sm" type="button" onclick={() => void closeSession()} disabled={busy || sessionRunning}>关闭</Button>
          {/if}
          {#if sessions.length > 0}
            <div class="session-list" aria-label="Codex 会话列表">
              {#each sessions as session (session.id)}
                <Button
                  variant={session.id === selectedSessionId ? 'secondary' : 'ghost'}
                  type="button"
                  class="session-item"
                  onclick={() => selectSession(session.id)}
                >
                  <span class="session-item-label">{session.label}</span>
                  <span class="session-item-state">{session.state}</span>
                </Button>
              {/each}
            </div>
          {/if}
        </div>
        <Separator />

        {#if timeline.length > 0}
          <div class="timeline-feed" aria-live="polite">
            {#each timeline as item (item.id)}
              <Card
                as="article"
                class={`timeline-entry ${item.role === 'assistant' ? 'assistant-entry' : item.role === 'user' ? 'user-entry' : ''}`}
              >
                <div class="entry-meta">
                  <Badge variant={item.role === 'assistant' ? 'secondary' : 'outline'}>{item.role === 'assistant' ? 'CODEX' : item.role.toUpperCase()}</Badge>
                  <Badge variant="outline">{item.status}</Badge>
                </div>
                <div class="entry-content">{item.content || '…'}</div>
              </Card>
            {/each}
          </div>
        {:else if selectedSession}
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

      <Card as="form" class="composer" onsubmit={(event) => { event.preventDefault(); void sendPrompt(); }}>
        <Textarea
          class="composer-textarea"
          bind:value={composerText}
          rows="2"
          placeholder={selectedSession ? '输入消息，⌘/Ctrl + Enter 发送…' : '先新建或选择一个 Codex 会话…'}
          disabled={!selectedSession || sessionRunning || busy}
          onkeydown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void sendPrompt();
            }
          }}
        ></Textarea>
        {#if sessionRunning}
          <Button variant="destructive" size="icon" type="button" onclick={() => void abortPrompt()} disabled={busy} aria-label="中止">
            <SquareIcon size={13} fill="currentColor" />
          </Button>
        {:else}
          <Button size="icon" type="submit" disabled={!selectedSession || !composerText.trim() || busy} aria-label="发送">
            <SendIcon size={14} />
          </Button>
        {/if}
      </Card>
    </Card>

    <Card as="aside" class="inspector" aria-label="Agent 诊断">
      <CardHeader class="panel-heading">
        <CardTitle>Agent 诊断</CardTitle>
        <Badge variant="success">{readyAgents}/{diagnostics.length} 就绪</Badge>
      </CardHeader>
      <Separator />

      <div class="agent-cards">
        {#each diagnostics as agent (agent.agent)}
          <Card as="article" class="agent-card">
            <CardHeader class="agent-card-head">
              <div class="agent-identity">
                <div><strong>{agent.label}</strong><small>{agent.version ?? 'version unavailable'}</small></div>
              </div>
              <Badge variant={agent.status === 'ready' ? 'success' : 'warning'}>{agent.status}</Badge>
            </CardHeader>
            <CardContent class="agent-card-content">
              <dl>
              <div><dt>通道</dt><dd>{agent.agent === 'codex' ? 'app-server' : 'sdk-host'}</dd></div>
              <div><dt>认证</dt><dd>{agent.authState === 'delegated' ? '系统凭据' : agent.authState}</dd></div>
              {#if agent.executable}<div><dt>可执行文件</dt><dd title={agent.executable}>{agent.executable}</dd></div>{/if}
              </dl>
              <div class="capability-list">
                {#each agent.capabilities as capability}<Badge variant="outline">{capability}</Badge>{/each}
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>

      {#if selectedWorkspace}
        <Card class="trust-card">
          <div class="trust-card-heading"><ShieldCheckIcon size={16} /><strong>工作区信任</strong></div>
          <p>{selectedWorkspace.trust === 'trusted' ? '当前目录已允许 Agent 操作。' : '确认目录来源后再启用 Agent 操作。'}</p>
          <div class="trust-actions">
            <Button variant="outline" size="sm" type="button" onclick={() => void toggleTrust(selectedWorkspace)} disabled={busy}>
              {selectedWorkspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
            </Button>
            <Button variant="ghost" size="sm" type="button" onclick={() => void deleteWorkspace(selectedWorkspace)} disabled={busy}>移除</Button>
          </div>
        </Card>
      {/if}

      <Separator />
      <div class="inspector-footer">
        <Button variant="ghost" size="sm" type="button" onclick={() => void refresh()} disabled={busy}>
          <RefreshCwIcon size={13} /> 刷新诊断
        </Button>
      </div>
    </Card>
  </main>

  {#if errorMessage}<Card class="toast error-toast">{errorMessage}</Card>{/if}
  {#if notice}<Card class="toast notice-toast">{notice}</Card>{/if}
</div>
