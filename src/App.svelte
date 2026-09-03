<script lang="ts">
  import { onMount } from 'svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SendIcon from '@lucide/svelte/icons/send';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import SquareIcon from '@lucide/svelte/icons/square';
  import { Badge } from '$lib/components/ui/badge';
  import { AlertDialog } from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    addWorkspace,
    abortCodexTurn,
    archiveCodexThread,
    closeCodexSession,
    closePiSession,
    createCodexSession,
    createPiSession,
    forkCodexThread,
    getTimeline,
    getPiSessionTree,
    isTauri,
    listCodexThreads,
    listWorkspaces,
    listSessions,
    listenToAgentEvents,
    probeAgents,
    readCodexThread,
    removeWorkspace,
    resolveCodexApproval,
    sendCodexPrompt,
    sendPiPrompt,
    steerPiPrompt,
    followUpPiPrompt,
    abortPiTurn,
    setWorkspaceTrust,
    unarchiveCodexThread,
  } from './lib/api';
  import type {
    AgentDiagnostic,
    AgentEvent,
    ApprovalDecision,
    ApprovalRequest,
    CodexThreadSnapshot,
    CodexThreadSummary,
    Session,
    PiSessionTreeNode,
    PiSessionTreeSnapshot,
    TimelineItem,
    Workspace,
  } from './lib/types';

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
      capabilities: ['sdk-host', 'streaming', 'abort', 'session-tree', 'read-only-tools'],
      authState: 'delegated',
      message: 'Project-locked SDK host; read-only tools only; native authentication remains with Pi.',
    },
  ];

  let workspaces = $state<Workspace[]>([]);
  let diagnostics = $state<AgentDiagnostic[]>([]);
  let sessions = $state<Session[]>([]);
  let timeline = $state<TimelineItem[]>([]);
  let pendingApprovals = $state<ApprovalRequest[]>([]);
  let codexThreads = $state<CodexThreadSummary[]>([]);
  let codexThreadSnapshot = $state<CodexThreadSnapshot | null>(null);
  let piTree = $state<PiSessionTreeSnapshot | null>(null);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedSessionId = $state<string | null>(null);
  let workspacePath = $state('');
  let composerText = $state('');
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let desktop = $state(false);
  let threadBusy = $state(false);
  let archiveConfirmationSessionId = $state<string | null>(null);

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
  const sessionArchived = $derived(selectedSession?.archived === true);
  const selectedApprovals = $derived(
    pendingApprovals.filter((approval) => approval.sessionId === selectedSessionId),
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
        await refreshCodexThreads(activeWorkspaceId);
      } else {
        sessions = [];
        timeline = [];
        codexThreads = [];
        codexThreadSnapshot = null;
        piTree = null;
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
      void refreshCodexThread(selectedSessionId);
      void refreshPiTree(selectedSessionId);
    } else {
      timeline = [];
      codexThreadSnapshot = null;
      piTree = null;
    }
  }

  async function refreshCodexThreads(workspaceId: string, announce = false) {
    if (!desktop) return;
    try {
      const loadedThreads = await listCodexThreads(workspaceId);
      if (workspaceId === selectedWorkspaceId) codexThreads = loadedThreads;
      if (announce) notice = `已读取 ${loadedThreads.length} 个 Codex 线程。`;
    } catch (error) {
      if (announce) errorMessage = toErrorMessage(error);
    }
  }

  async function refreshCodexThread(sessionId: string, announce = false) {
    const session = sessions.find((item) => item.id === sessionId);
    if (
      !desktop ||
      !session ||
      session.agent !== 'codex' ||
      session.archived ||
      !session.externalSessionId
    ) {
      if (sessionId === selectedSessionId) codexThreadSnapshot = null;
      return;
    }
    try {
      const snapshot = await readCodexThread(sessionId);
      if (sessionId === selectedSessionId) codexThreadSnapshot = snapshot;
      if (announce) notice = `已读取远端线程，共 ${snapshot.turnCount} 轮。`;
    } catch (error) {
      if (sessionId === selectedSessionId) codexThreadSnapshot = null;
      if (announce) errorMessage = toErrorMessage(error);
    }
  }

  async function syncCodexThreads() {
    if (!selectedWorkspaceId || !desktop) return;
    threadBusy = true;
    errorMessage = null;
    try {
      await refreshCodexThreads(selectedWorkspaceId, true);
    } finally {
      threadBusy = false;
    }
  }

  async function syncCodexThread(sessionId: string) {
    threadBusy = true;
    errorMessage = null;
    try {
      await refreshCodexThread(sessionId, true);
    } finally {
      threadBusy = false;
    }
  }

  async function refreshTimeline(sessionId: string) {
    const loadedTimeline = await getTimeline(sessionId);
    if (sessionId === selectedSessionId) timeline = loadedTimeline;
  }

  async function refreshPiTree(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!desktop || !session || session.agent !== 'pi') {
      if (sessionId === selectedSessionId) piTree = null;
      return;
    }
    try {
      const snapshot = await getPiSessionTree(sessionId);
      if (sessionId === selectedSessionId) piTree = snapshot;
    } catch (error) {
      if (sessionId === selectedSessionId) piTree = null;
      console.warn('unable to read Pi session tree', error);
    }
  }

  function handleAgentEvent(event: AgentEvent) {
    if (event.workspaceId !== selectedWorkspaceId) return;

    const state = event.type === 'session.state_changed' ? event.payload.state : undefined;
    if (typeof state === 'string') {
      sessions = sessions.map((session) =>
        session.id === event.sessionId ? { ...session, state: state as Session['state'] } : session,
      );
    }

    if (event.type === 'approval.requested') {
      const approval = approvalFromEvent(event);
      if (approval) {
        pendingApprovals = [
          ...pendingApprovals.filter(
            (item) => item.sessionId !== approval.sessionId || item.requestId !== approval.requestId,
          ),
          approval,
        ];
      }
    }

    if (event.type === 'approval.resolved') {
      const requestId = payloadString(event.payload.requestId);
      if (requestId) {
        pendingApprovals = pendingApprovals.filter(
          (approval) => approval.sessionId !== event.sessionId || approval.requestId !== requestId,
        );
      }
    }

    if (event.type === 'adapter.crashed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
      pendingApprovals = pendingApprovals.filter((approval) => approval.sessionId !== event.sessionId);
    }

    if (event.type === 'adapter.crashed' && event.sessionId === selectedSessionId) {
      const discarded =
        typeof event.payload.pendingApprovalCount === 'number'
          ? event.payload.pendingApprovalCount
          : 0;
      const agentLabel = selectedSession?.agent === 'pi' ? 'Pi' : 'Codex';
      notice =
        discarded > 0
          ? `${agentLabel} 进程已退出，${discarded} 个待审批请求已清除；请重新发送。`
          : `${agentLabel} 进程已退出，会话已中断；可重新发送以恢复。`;
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

    if (
      event.sessionId === selectedSessionId &&
      (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed')
    ) {
      const externalMessageId = stringPayload(event.payload.itemId) ?? `tool:${event.eventId}`;
      const delta = event.type === 'tool.updated' ? stringPayload(event.payload.delta) : null;
      const summary = stringPayload(event.payload.summary) ?? delta ?? '工具操作';
      const output = stringPayload(event.payload.output);
      const statusValue = stringPayload(event.payload.status);
      const status: TimelineItem['status'] =
        event.type === 'tool.completed'
          ? statusValue === 'failed' || statusValue === 'error'
            ? 'failed'
            : 'completed'
          : 'streaming';
      const existing = timeline.find((item) => item.externalMessageId === externalMessageId);
      if (existing) {
        timeline = timeline.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                content: delta
                  ? item.content + delta
                  : event.type === 'tool.started' || output
                    ? summary
                    : item.content,
                status,
                updatedAt: event.occurredAt,
              }
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
            role: 'tool',
            content: summary,
            status,
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

  function payloadString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  function approvalFromEvent(event: AgentEvent): ApprovalRequest | null {
    const requestId = payloadString(event.payload.requestId);
    if (!requestId) return null;
    const availableDecisions = Array.isArray(event.payload.availableDecisions)
      ? event.payload.availableDecisions.filter(
          (decision): decision is ApprovalDecision => decision === 'accept' || decision === 'cancel',
        )
      : [];
    return {
      requestId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      kind: payloadString(event.payload.kind) ?? 'approval',
      command: payloadString(event.payload.command),
      cwd: payloadString(event.payload.cwd),
      availableDecisions: availableDecisions.length > 0 ? availableDecisions : ['accept', 'cancel'],
    };
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
      void refreshCodexThreads(selectedWorkspace.id);
      notice = 'Codex 会话已启动，可以发送第一条消息。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function createPi() {
    if (!selectedWorkspace) {
      errorMessage = '请先选择一个工作区。';
      return;
    }
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中启动 Pi。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      const session = await createPiSession(selectedWorkspace.id);
      sessions = [session, ...sessions.filter(({ id }) => id !== session.id)];
      selectedSessionId = session.id;
      timeline = [];
      piTree = null;
      void refreshPiTree(session.id);
      notice = 'Pi SDK 会话已启动；当前仅开放只读工具，Pi 本身不提供原生沙箱。';
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
    if (selectedSession?.archived) {
      errorMessage = '已归档的 Codex 会话不能继续发送消息，请先取消归档或创建分支。';
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
      if (session.agent === 'pi') await sendPiPrompt(session.id, input);
      else await sendCodexPrompt(session.id, input);
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
      if (selectedSession.agent === 'pi') await abortPiTurn(selectedSession.id);
      else await abortCodexTurn(selectedSession.id);
      pendingApprovals = pendingApprovals.filter(
        (approval) => approval.sessionId !== selectedSession?.id,
      );
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function queuePiPrompt(mode: 'steer' | 'followUp') {
    const input = composerText.trim();
    if (!input || !selectedSession || selectedSession.agent !== 'pi' || !desktop) return;
    busy = true;
    errorMessage = null;
    try {
      if (mode === 'steer') await steerPiPrompt(selectedSession.id, input);
      else await followUpPiPrompt(selectedSession.id, input);
      await refreshTimeline(selectedSession.id);
      composerText = '';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function resolveApproval(approval: ApprovalRequest, decision: ApprovalDecision) {
    if (!desktop) {
      notice = '当前是 Web 预览；审批操作需要在 Tauri 桌面模式中执行。';
      return;
    }
    if (!approval.availableDecisions.includes(decision)) return;

    busy = true;
    errorMessage = null;
    try {
      await resolveCodexApproval(approval.sessionId, approval.requestId, decision);
      pendingApprovals = pendingApprovals.filter(
        (item) => item.sessionId !== approval.sessionId || item.requestId !== approval.requestId,
      );
      notice = decision === 'accept' ? '已允许本次操作。' : '已拒绝本次操作。';
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
      const closingAgent = selectedSession.agent;
      if (selectedSession.agent === 'pi') await closePiSession(closingId);
      else await closeCodexSession(closingId);
      const remaining = sessions.filter(({ id }) => id !== closingId);
      sessions = remaining;
      selectedSessionId = remaining[0]?.id ?? null;
      codexThreadSnapshot = null;
      piTree = null;
      timeline = selectedSessionId ? await getTimeline(selectedSessionId) : [];
      if (selectedSessionId) void refreshPiTree(selectedSessionId);
      notice = `${closingAgent === 'pi' ? 'Pi' : 'Codex'} 会话已关闭；已保存的时间线仍可在下次启动时读取。`;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function forkSession() {
    if (!selectedSession || !desktop || selectedSession.archived) return;
    if (sessionRunning) {
      errorMessage = '请等待当前 turn 完成后再创建分支。';
      return;
    }
    busy = true;
    errorMessage = null;
    try {
      const forked = await forkCodexThread(selectedSession.id);
      sessions = [forked, ...sessions.filter(({ id }) => id !== forked.id)];
      selectedSessionId = forked.id;
      timeline = await getTimeline(forked.id);
      codexThreadSnapshot = null;
      void refreshCodexThread(forked.id);
      void refreshCodexThreads(selectedWorkspaceId ?? forked.workspaceId);
      notice = 'Codex 分支已创建，已复制最近一条已完成 turn。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function requestArchiveSession() {
    if (!selectedSession || !desktop || selectedSession.archived) return;
    if (sessionRunning) {
      errorMessage = '请等待当前 turn 完成后再归档。';
      return;
    }
    archiveConfirmationSessionId = selectedSession.id;
  }

  async function confirmArchiveSession() {
    const sessionId = archiveConfirmationSessionId;
    archiveConfirmationSessionId = null;
    if (!sessionId) return;
    const target = sessions.find((item) => item.id === sessionId);
    if (!target || target.archived) return;
    busy = true;
    errorMessage = null;
    try {
      const archived = await archiveCodexThread(sessionId);
      sessions = sessions.map((item) => (item.id === archived.id ? archived : item));
      pendingApprovals = pendingApprovals.filter((item) => item.sessionId !== archived.id);
      codexThreadSnapshot = null;
      void refreshCodexThreads(archived.workspaceId);
      notice = 'Codex 线程已归档；本地时间线仍保留。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function unarchiveSession() {
    if (!selectedSession || !desktop || !selectedSession.archived) return;
    busy = true;
    errorMessage = null;
    try {
      const restored = await unarchiveCodexThread(selectedSession.id);
      sessions = sessions.map((item) => (item.id === restored.id ? restored : item));
      selectedSessionId = restored.id;
      timeline = await getTimeline(restored.id);
      void refreshCodexThread(restored.id, true);
      void refreshCodexThreads(restored.workspaceId);
      notice = 'Codex 线程已取消归档，可以继续发送消息。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function selectSession(id: string) {
    selectedSessionId = id;
    if (desktop) {
      void refreshTimeline(id);
      void refreshCodexThread(id);
      void refreshPiTree(id);
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
      sessions = [];
      timeline = [];
      codexThreads = [];
      codexThreadSnapshot = null;
      piTree = null;
      if (selectedWorkspaceId) {
        void refreshSessions(selectedWorkspaceId);
        void refreshCodexThreads(selectedWorkspaceId);
      }
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
    codexThreads = [];
    codexThreadSnapshot = null;
    piTree = null;
    if (desktop) {
      void refreshSessions(id);
      void refreshCodexThreads(id);
    }
    notice = null;
  }

  function toErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return '操作失败，请查看诊断日志。';
  }

  function flattenPiTree(nodes: PiSessionTreeNode[], depth = 0): Array<{ node: PiSessionTreeNode; depth: number }> {
    return nodes.flatMap((node) => [
      { node, depth },
      ...flattenPiTree(node.children ?? [], depth + 1),
    ]);
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
            <Badge variant={sessionArchived ? 'secondary' : sessionRunning ? 'warning' : 'outline'}>
              {sessionArchived ? '已归档' : selectedSession.state}
            </Badge>
            {#if codexThreadSnapshot && codexThreadSnapshot.id === selectedSession.externalSessionId}
              <Badge variant="outline">远端 {codexThreadSnapshot.turnCount} 轮</Badge>
            {/if}
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
            <PlusIcon size={14} /> 新建 Codex
          </Button>
          <Button variant="outline" size="sm" type="button" onclick={() => void createPi()} disabled={busy}>
            <PlusIcon size={14} /> 新建 Pi
          </Button>
          {#if selectedSession}
            {#if selectedSession.agent === 'codex' && sessionArchived}
              <Badge variant="secondary">已归档</Badge>
              <Button variant="outline" size="sm" type="button" onclick={() => void unarchiveSession()} disabled={busy}>取消归档</Button>
            {:else if selectedSession.agent === 'codex'}
              <Button variant="ghost" size="sm" type="button" onclick={() => void forkSession()} disabled={busy || sessionRunning}>分支</Button>
              <Button variant="ghost" size="sm" type="button" onclick={requestArchiveSession} disabled={busy || sessionRunning}>归档</Button>
              <Button variant="ghost" size="sm" type="button" onclick={() => void closeSession()} disabled={busy || sessionRunning}>关闭</Button>
              <Button variant="ghost" size="sm" type="button" onclick={() => void syncCodexThread(selectedSession.id)} disabled={threadBusy || busy}>
                <RefreshCwIcon size={13} /> 读取线程
              </Button>
            {:else}
              <Badge variant="outline">SDK host · 只读工具</Badge>
              <Button variant="ghost" size="sm" type="button" onclick={() => void closeSession()} disabled={busy || sessionRunning}>关闭</Button>
            {/if}
          {/if}
          {#if sessions.length > 0}
            <div class="session-list" aria-label="Agent 会话列表">
              {#each sessions as session (session.id)}
                <Button
                  variant={session.id === selectedSessionId ? 'secondary' : 'ghost'}
                  type="button"
                  class="session-item"
                  onclick={() => selectSession(session.id)}
                >
                  <span class="session-item-label">{session.label}</span>
                  <span class="session-item-state">{session.archived ? '已归档' : session.state}</span>
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
                class={`timeline-entry ${item.role === 'assistant' ? 'assistant-entry' : item.role === 'user' ? 'user-entry' : item.role === 'tool' ? 'tool-entry' : ''}`}
              >
                <div class="entry-meta">
                  <Badge variant={item.role === 'assistant' ? 'secondary' : item.role === 'tool' ? 'outline' : 'outline'}>{item.role === 'assistant' ? (selectedSession?.agent === 'pi' ? 'PI' : 'CODEX') : item.role.toUpperCase()}</Badge>
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

      {#if selectedApprovals.length > 0}
        <div class="approval-list" aria-live="assertive">
          {#each selectedApprovals as approval (approval.requestId)}
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
                    <Button variant="ghost" size="sm" type="button" onclick={() => void resolveApproval(approval, 'cancel')} disabled={busy}>拒绝</Button>
                  {/if}
                  {#if approval.availableDecisions.includes('accept')}
                    <Button size="sm" type="button" onclick={() => void resolveApproval(approval, 'accept')} disabled={busy}>允许</Button>
                  {/if}
                </div>
              </CardContent>
            </Card>
          {/each}
        </div>
      {/if}

      <Card as="form" class="composer" onsubmit={(event) => { event.preventDefault(); void sendPrompt(); }}>
        <Textarea
          class="composer-textarea"
          bind:value={composerText}
          rows="2"
          placeholder={sessionArchived ? '该会话已归档，请取消归档或创建分支继续…' : selectedSession ? '输入消息，⌘/Ctrl + Enter 发送…' : '先新建或选择一个 Agent 会话…'}
          disabled={!selectedSession || sessionArchived || (sessionRunning && selectedSession?.agent === 'codex') || busy}
          onkeydown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              if (sessionRunning && selectedSession?.agent === 'pi') void queuePiPrompt('steer');
              else void sendPrompt();
            }
          }}
        ></Textarea>
        {#if sessionRunning}
          {#if selectedSession?.agent === 'pi'}
            <Button variant="outline" size="sm" type="button" onclick={() => void queuePiPrompt('steer')} disabled={busy || !composerText.trim()}>插入</Button>
            <Button variant="outline" size="sm" type="button" onclick={() => void queuePiPrompt('followUp')} disabled={busy || !composerText.trim()}>跟进</Button>
          {/if}
          <Button variant="destructive" size="icon" type="button" onclick={() => void abortPrompt()} disabled={busy} aria-label="中止">
            <SquareIcon size={13} fill="currentColor" />
          </Button>
        {:else}
          <Button size="icon" type="submit" disabled={!selectedSession || sessionArchived || !composerText.trim() || busy} aria-label="发送">
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

      {#if selectedWorkspace && desktop}
        <Card class="thread-card">
          <CardHeader class="thread-card-heading">
            <CardTitle>Codex 线程</CardTitle>
            <Badge variant="secondary" class="count-pill">{codexThreads.length}</Badge>
          </CardHeader>
          <CardContent class="thread-card-content">
            {#if codexThreads.length === 0}
              <p class="thread-empty">暂无远端线程</p>
            {:else}
              <div class="thread-list" aria-label="Codex 线程列表">
                {#each codexThreads.slice(0, 5) as thread (thread.id)}
                  <div class="thread-item">
                    <div class="thread-copy">
                      <strong>{thread.title ?? thread.id}</strong>
                      <small>{thread.cwd ?? '当前工作区'}{thread.updatedAt ? ` · ${thread.updatedAt}` : ''}</small>
                    </div>
                    <Badge variant="outline">{thread.status ?? 'unknown'}</Badge>
                  </div>
                {/each}
              </div>
              {#if codexThreads.length > 5}<small class="thread-more">仅显示最近 5 个线程</small>{/if}
            {/if}
            <Button variant="ghost" size="sm" type="button" onclick={() => void syncCodexThreads()} disabled={threadBusy || busy}>
              <RefreshCwIcon size={13} /> 刷新线程
            </Button>
          </CardContent>
        </Card>
      {/if}

      {#if selectedSession?.agent === 'pi' && desktop && piTree}
        <Card class="thread-card">
          <CardHeader class="thread-card-heading">
            <CardTitle>Pi 会话树</CardTitle>
            <Badge variant="secondary" class="count-pill">{flattenPiTree(piTree.tree).length}</Badge>
          </CardHeader>
          <CardContent class="thread-card-content">
            {#if piTree.tree.length === 0}
              <p class="thread-empty">首条消息后生成会话树</p>
            {:else}
              <div class="thread-list" aria-label="Pi 会话树">
                {#each flattenPiTree(piTree.tree) as entry (entry.node.id)}
                  <div class="thread-item" style={`padding-left: ${entry.depth * 14}px`}>
                    <div class="thread-copy">
                      <strong>{entry.node.label ?? entry.node.summary ?? entry.node.type}</strong>
                      <small>{entry.node.role ?? entry.node.type}{entry.node.id === piTree.leafId ? ' · 当前分支' : ''}</small>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            <Button variant="ghost" size="sm" type="button" onclick={() => void refreshPiTree(selectedSession.id)} disabled={busy}>
              <RefreshCwIcon size={13} /> 刷新会话树
            </Button>
          </CardContent>
        </Card>
      {/if}

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
  <AlertDialog
    open={archiveConfirmationSessionId !== null}
    title="归档 Codex 线程？"
    description="归档会隐藏远端线程，但不会删除 Aibo 中已保存的本地时间线。"
    confirmText="归档"
    cancelText="取消"
    onConfirm={() => void confirmArchiveSession()}
    onCancel={() => (archiveConfirmationSessionId = null)}
  />
</div>
