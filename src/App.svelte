<script lang="ts">
  import { onMount } from 'svelte';
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
    <div class="brand-lockup">
      <div class="brand-mark">A</div>
      <div>
        <div class="eyebrow">LOCAL AGENT WORKBENCH</div>
        <h1>Aibo</h1>
      </div>
    </div>
    <div class="topbar-meta">
      <span class:desktop-badge={desktop} class="mode-badge">{desktop ? 'macOS desktop' : 'Web preview'}</span>
      <span class="connection"><span class="status-dot"></span> Core ready</span>
    </div>
  </header>

  <main class="workspace-grid">
    <aside class="sidebar panel">
      <div class="panel-heading">
        <div>
          <div class="eyebrow">WORKSPACES</div>
          <h2>工作区</h2>
        </div>
        <span class="count-pill">{workspaces.length}</span>
      </div>

      <form class="workspace-form" onsubmit={(event) => { event.preventDefault(); void createWorkspace(); }}>
        <label for="workspace-path">添加本地目录</label>
        <div class="input-row">
          <input id="workspace-path" bind:value={workspacePath} placeholder="/Users/you/Workspace/project" autocomplete="off" />
          <button class="icon-button" type="submit" aria-label="添加工作区" disabled={busy}>+</button>
        </div>
        <p class="field-help">路径必须已存在；Aibo 只保存 canonical path。</p>
      </form>

      <div class="workspace-list" aria-label="工作区列表">
        {#if workspaces.length === 0}
          <div class="empty-list">还没有工作区<br /><span>从上方添加一个目录开始</span></div>
        {:else}
          {#each workspaces as workspace (workspace.id)}
            <button
              class:active={workspace.id === selectedWorkspaceId}
              class="workspace-item"
              type="button"
              onclick={() => selectWorkspace(workspace.id)}
            >
              <span class="workspace-icon">⌘</span>
              <span class="workspace-copy">
                <strong>{workspace.label}</strong>
                <small>{workspace.path}</small>
              </span>
              <span class:trusted={workspace.trust === 'trusted'} class="trust-dot" title={workspace.trust}></span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="sidebar-footer">
        <span class="legend"><span class="trust-dot trusted"></span> trusted</span>
        <span class="legend"><span class="trust-dot"></span> review required</span>
      </div>
    </aside>

    <section class="timeline panel">
      <div class="panel-heading timeline-heading">
        <div>
          <div class="eyebrow">TIMELINE</div>
          <h2>{selectedSession?.label ?? selectedWorkspace?.label ?? '选择一个工作区'}</h2>
        </div>
        <div class="timeline-heading-actions">
          {#if selectedSession}<span class="session-state">{selectedSession.state}</span>{/if}
          {#if selectedWorkspace}
            <span class:trusted={selectedWorkspace.trust === 'trusted'} class="trust-label">
              {selectedWorkspace.trust === 'trusted' ? 'Trusted workspace' : 'Trust required'}
            </span>
          {/if}
        </div>
      </div>

      {#if selectedWorkspace}
        <div class="session-toolbar">
          <button type="button" class="new-session-button" onclick={() => void createCodex()} disabled={busy}>
            <span>＋</span> 新建 Codex 会话
          </button>
          {#if selectedSession}
            <button type="button" class="close-session-button" onclick={() => void closeSession()} disabled={busy || sessionRunning}>关闭</button>
          {/if}
          {#if sessions.length > 0}
            <div class="session-list" aria-label="Codex 会话列表">
              {#each sessions as session (session.id)}
                <button
                  type="button"
                  class:active={session.id === selectedSessionId}
                  class="session-item"
                  onclick={() => selectSession(session.id)}
                >
                  <span class="session-item-label">{session.label}</span>
                  <span class="session-item-state">{session.state}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if timeline.length > 0}
          <div class="timeline-feed" aria-live="polite">
            {#each timeline as item (item.id)}
              <article class:assistant-entry={item.role === 'assistant'} class:user-entry={item.role === 'user'} class="timeline-entry">
                <div class="entry-meta">
                  <span>{item.role === 'assistant' ? 'CODEX' : item.role.toUpperCase()}</span>
                  <span>{item.status}</span>
                </div>
                <div class="entry-content">{item.content || '…'}</div>
              </article>
            {/each}
          </div>
        {:else if selectedSession}
          <div class="timeline-empty compact-empty">
            <div class="orbit"><span></span><span></span><span></span></div>
            <h3>发送第一条消息</h3>
            <p>Codex App Server 已连接；输入提示后会在这里实时显示响应。</p>
          </div>
        {:else}
          <div class="timeline-empty compact-empty">
            <div class="empty-symbol">⌘</div>
            <h3>新建一个 Codex 会话</h3>
            <p>会话绑定当前工作区，并在本机 SQLite 中保存可恢复的时间线。</p>
          </div>
        {/if}
      {:else}
        <div class="timeline-empty">
          <div class="empty-symbol">⌘</div>
          <h3>从一个工作区开始</h3>
          <p>添加本地目录后，Aibo 会在这里呈现统一的 Agent 时间线。</p>
        </div>
      {/if}

      <form class="composer" onsubmit={(event) => { event.preventDefault(); void sendPrompt(); }}>
        <textarea
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
        ></textarea>
        {#if sessionRunning}
          <button type="button" class="send-button stop-button" onclick={() => void abortPrompt()} disabled={busy} aria-label="中止">■</button>
        {:else}
          <button type="submit" class="send-button" disabled={!selectedSession || !composerText.trim() || busy} aria-label="发送">↑</button>
        {/if}
      </form>
    </section>

    <aside class="inspector panel">
      <div class="panel-heading">
        <div>
          <div class="eyebrow">SYSTEM CHECK</div>
          <h2>Agent 诊断</h2>
        </div>
        <span class="ready-count">{readyAgents}/{diagnostics.length} ready</span>
      </div>

      <div class="agent-cards">
        {#each diagnostics as agent (agent.agent)}
          <article class="agent-card">
            <div class="agent-card-head">
              <div class="agent-identity">
                <span class:pi={agent.agent === 'pi'} class="agent-avatar">{agent.agent === 'codex' ? 'C' : 'P'}</span>
                <div><strong>{agent.label}</strong><small>{agent.version ?? 'version unavailable'}</small></div>
              </div>
              <span class:missing={agent.status !== 'ready'} class="status-label"><span class="status-dot"></span>{agent.status}</span>
            </div>
            <dl>
              <div><dt>transport</dt><dd>{agent.agent === 'codex' ? 'app-server' : 'sdk-host'}</dd></div>
              <div><dt>auth</dt><dd>{agent.authState === 'delegated' ? 'native store' : agent.authState}</dd></div>
              {#if agent.executable}<div><dt>binary</dt><dd title={agent.executable}>{agent.executable}</dd></div>{/if}
            </dl>
            <div class="capability-list">
              {#each agent.capabilities as capability}<span>{capability}</span>{/each}
            </div>
            {#if agent.message}<p class="agent-message">{agent.message}</p>{/if}
          </article>
        {/each}
      </div>

      {#if selectedWorkspace}
        <div class="trust-card">
          <div class="trust-card-heading"><span class="shield">⌁</span><strong>Workspace trust</strong></div>
          <p>{selectedWorkspace.trust === 'trusted' ? '该目录允许启动可写 Agent 会话。' : '确认目录来源后再允许 Pi 启动可写会话。'}</p>
          <div class="trust-actions">
            <button type="button" class="secondary-button" onclick={() => void toggleTrust(selectedWorkspace)} disabled={busy}>
              {selectedWorkspace.trust === 'trusted' ? '撤销信任' : '标记为可信'}
            </button>
            <button type="button" class="danger-link" onclick={() => void deleteWorkspace(selectedWorkspace)} disabled={busy}>移除</button>
          </div>
        </div>
      {/if}

      <div class="inspector-footer"><button type="button" class="refresh-link" onclick={() => void refresh()} disabled={busy}>↻ 刷新诊断</button></div>
    </aside>
  </main>

  {#if errorMessage}<div class="toast error-toast">{errorMessage}</div>{/if}
  {#if notice}<div class="toast notice-toast">{notice}</div>{/if}
</div>
