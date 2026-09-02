<script lang="ts">
  import { onMount } from 'svelte';
  import {
    addWorkspace,
    isTauri,
    listWorkspaces,
    probeAgents,
    removeWorkspace,
    setWorkspaceTrust,
  } from './lib/api';
  import type { AgentDiagnostic, Workspace } from './lib/types';

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
  let selectedWorkspaceId = $state<string | null>(null);
  let workspacePath = $state('');
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let desktop = $state(false);

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const readyAgents = $derived(diagnostics.filter((agent) => agent.status === 'ready').length);

  onMount(async () => {
    desktop = isTauri();
    if (!desktop) {
      workspaces = previewWorkspaces;
      diagnostics = previewDiagnostics;
      selectedWorkspaceId = previewWorkspaces[0]?.id ?? null;
      return;
    }

    await refresh();
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
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
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
      notice = '工作区已从 Aibo 移除；本地目录未被删除。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function selectWorkspace(id: string) {
    selectedWorkspaceId = id;
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
          <h2>{selectedWorkspace?.label ?? '选择一个工作区'}</h2>
        </div>
        {#if selectedWorkspace}
          <span class:trusted={selectedWorkspace.trust === 'trusted'} class="trust-label">
            {selectedWorkspace.trust === 'trusted' ? 'Trusted workspace' : 'Trust required'}
          </span>
        {/if}
      </div>

      {#if selectedWorkspace}
        <div class="timeline-empty">
          <div class="orbit"><span></span><span></span><span></span></div>
          <h3>等待第一个会话</h3>
          <p>Phase 1 先完成工作区和状态恢复。真实 Codex 会话将在下一阶段接入。</p>
          <div class="empty-path">{selectedWorkspace.path}</div>
        </div>
      {:else}
        <div class="timeline-empty">
          <div class="empty-symbol">⌘</div>
          <h3>从一个工作区开始</h3>
          <p>添加本地目录后，Aibo 会在这里呈现统一的 Agent 时间线。</p>
        </div>
      {/if}

      <div class="composer composer-disabled">
        <div class="composer-placeholder">输入消息，或使用 @ 引用一个已完成的会话…</div>
        <button type="button" class="send-button" disabled aria-label="发送">↑</button>
      </div>
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
