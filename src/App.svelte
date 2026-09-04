<script lang="ts">
  import { onMount } from 'svelte';
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
  import { open } from '@tauri-apps/plugin-dialog';
  import SendIcon from '@lucide/svelte/icons/send';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import SquareIcon from '@lucide/svelte/icons/square';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import XIcon from '@lucide/svelte/icons/x';
  import { Badge } from '$lib/components/ui/badge';
  import { AlertDialog } from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    addWorkspace,
    abortCodexTurn,
    archiveSession as archiveSessionApi,
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
    navigatePiSessionTree,
    probeAgents,
    readCodexThread,
    renameSession as renameSessionApi,
    removeWorkspace,
    resolveCodexApproval,
    sendCodexPrompt,
    sendPiPrompt,
    steerPiPrompt,
    followUpPiPrompt,
    abortPiTurn,
    setWorkspaceTrust,
    unarchiveSession as unarchiveSessionApi,
  } from './lib/api';
  import type {
    AgentDiagnostic,
    AgentEvent,
    ApprovalDecision,
    ApprovalRequest,
    CodexThreadSnapshot,
    CodexThreadSummary,
    Session,
    SessionFilter,
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
      capabilities: ['sdk-host', 'streaming', 'abort', 'session-tree', 'session-tree-navigation', 'session-snapshot', 'read-only-tools'],
      authState: 'delegated',
      message: 'Project-locked SDK host; read-only tools only; native authentication remains with Pi.',
    },
  ];

  let workspaces = $state<Workspace[]>([]);
  let diagnostics = $state<AgentDiagnostic[]>([]);
  let workspaceSessionMap = $state<Record<string, Session[]>>({});
  let timeline = $state<TimelineItem[]>([]);
  let pendingApprovals = $state<ApprovalRequest[]>([]);
  let codexThreads = $state<CodexThreadSummary[]>([]);
  let codexThreadSnapshot = $state<CodexThreadSnapshot | null>(null);
  let piTree = $state<PiSessionTreeSnapshot | null>(null);
  let selectedWorkspaceId = $state<string | null>(null);
  let expandedWorkspaceIds = $state<string[]>([]);
  let selectedSessionId = $state<string | null>(null);
  let sessionsLoadingWorkspaceIds = $state<string[]>([]);
  let sessionLoadGenerations = $state<Record<string, number>>({});
  let composerText = $state('');
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let desktop = $state(false);
  let threadBusy = $state(false);
  let archiveConfirmationSessionId = $state<string | null>(null);
  let archivingSessionId = $state<string | null>(null);
  let archivingWorkspaceId = $state<string | null>(null);
  let piNavigationEntryId = $state<string | null>(null);
  let sessionSearch = $state('');
  let sessionFilter = $state<SessionFilter>('active');
  let sessionSearchOpen = $state(false);
  let sessionFilterOpen = $state(false);
  let createSessionWorkspaceId = $state<string | null>(null);
  let renamingSessionId = $state<string | null>(null);
  let sessionLabelDraft = $state('');
  let timelineVisibleCount = $state(80);
  let usageSnapshot = $state<Record<string, unknown> | null>(null);
  let retryPrompt = $state<string | null>(null);
  let retryReason = $state<string | null>(null);
  let lastSubmittedPrompt = $state<string | null>(null);
  let settingsOpen = $state(false);
  let promptInFlight = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  const visibleTimeline = $derived(
    timeline.slice(Math.max(0, timeline.length - timelineVisibleCount)),
  );
  const hiddenTimelineCount = $derived(Math.max(0, timeline.length - visibleTimeline.length));

  const selectedWorkspace = $derived(
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
  );

  const sessions = $derived(workspaceSessionMap[selectedWorkspaceId ?? ''] ?? []);

  const selectedSession = $derived(
    sessions.find((session) => session.id === selectedSessionId) ?? null,
  );

  const readyAgents = $derived(diagnostics.filter((agent) => agent.status === 'ready').length);
  const sessionRunning = $derived(isSessionRunning(selectedSession));
  const sessionArchived = $derived(selectedSession?.archived === true);
  const selectedSessionArchiving = $derived(
    selectedSessionId !== null && selectedSessionId === archivingSessionId,
  );
  const selectedApprovals = $derived(
    pendingApprovals.filter((approval) => approval.sessionId === selectedSessionId),
  );
  const agentActivityLabel = $derived.by(() => {
    if (!selectedSession) return null;
    if (selectedSessionArchiving) return '正在归档会话…';
    if (!sessionRunning && !promptInFlight) return null;
    if (selectedSession.state === 'waiting_approval' || selectedApprovals.length > 0) {
      return '等待你的确认…';
    }
    const latest = timeline.at(-1);
    const agentLabel = selectedSession.agent === 'pi' ? 'Pi' : 'Codex';
    if (latest?.role === 'tool' && latest.status === 'streaming') {
      return `${agentLabel} 正在调用 ${toolLabel(latest)}…`;
    }
    return `${agentLabel} 正在响应…`;
  });

  $effect(() => {
    const message = notice;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    if (!message) return;
    const timer = setTimeout(() => {
      if (notice === message) notice = null;
      noticeTimer = undefined;
    }, 3600);
    noticeTimer = timer;
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const message = errorMessage;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = undefined;
    if (!message) return;
    const timer = setTimeout(() => {
      if (errorMessage === message) errorMessage = null;
      errorTimer = undefined;
    }, 6000);
    errorTimer = timer;
    return () => clearTimeout(timer);
  });

  onMount(() => {
    let stopListening: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      desktop = isTauri();
      if (!desktop) {
        workspaces = previewWorkspaces;
        diagnostics = previewDiagnostics;
        selectedWorkspaceId = previewWorkspaces[0]?.id ?? null;
        expandedWorkspaceIds = selectedWorkspaceId ? [selectedWorkspaceId] : [];
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
      const validWorkspaceIds = new Set(loadedWorkspaces.map(({ id }) => id));
      expandedWorkspaceIds = expandedWorkspaceIds.filter((id) => validWorkspaceIds.has(id));
      if (activeWorkspaceId && !expandedWorkspaceIds.includes(activeWorkspaceId)) {
        expandedWorkspaceIds = [...expandedWorkspaceIds, activeWorkspaceId];
      }
      if (activeWorkspaceId) {
        const workspaceIds = Array.from(new Set([activeWorkspaceId, ...expandedWorkspaceIds]));
        await Promise.all(workspaceIds.map((id) => refreshSessions(id)));
        await refreshCodexThreads(activeWorkspaceId);
      } else {
        workspaceSessionMap = {};
        timeline = [];
        codexThreads = [];
        codexThreadSnapshot = null;
        piTree = null;
        piNavigationEntryId = null;
      }
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function refreshSessions(workspaceId: string) {
    const generation = (sessionLoadGenerations[workspaceId] ?? 0) + 1;
    sessionLoadGenerations = { ...sessionLoadGenerations, [workspaceId]: generation };
    if (!sessionsLoadingWorkspaceIds.includes(workspaceId)) {
      sessionsLoadingWorkspaceIds = [...sessionsLoadingWorkspaceIds, workspaceId];
    }
    try {
      const loadedSessions = await listSessions(workspaceId, {
        search: sessionSearch,
        statusFilter: sessionFilter,
      });
      if (sessionLoadGenerations[workspaceId] !== generation) return;
      workspaceSessionMap = { ...workspaceSessionMap, [workspaceId]: loadedSessions };
      if (workspaceId !== selectedWorkspaceId) return;
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
        piNavigationEntryId = null;
        usageSnapshot = null;
        retryPrompt = null;
        retryReason = null;
      }
    } finally {
      if (sessionLoadGenerations[workspaceId] === generation) {
        sessionsLoadingWorkspaceIds = sessionsLoadingWorkspaceIds.filter((id) => id !== workspaceId);
      }
    }
  }

  async function refreshExpandedSessions() {
    const workspaceIds = Array.from(
      new Set([selectedWorkspaceId, ...expandedWorkspaceIds].filter((id): id is string => Boolean(id))),
    );
    await Promise.all(workspaceIds.map((id) => refreshSessions(id)));
  }

  function getWorkspaceSessions(workspaceId: string): Session[] {
    return workspaceSessionMap[workspaceId] ?? [];
  }

  function updateWorkspaceSessions(workspaceId: string, updater: (items: Session[]) => Session[]) {
    workspaceSessionMap = {
      ...workspaceSessionMap,
      [workspaceId]: updater(getWorkspaceSessions(workspaceId)),
    };
  }

  function findSession(sessionId: string): Session | null {
    for (const workspaceSessions of Object.values(workspaceSessionMap)) {
      const session = workspaceSessions.find((item) => item.id === sessionId);
      if (session) return session;
    }
    return null;
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
    if (sessionId === archivingSessionId) return;
    const session = findSession(sessionId);
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
    if (sessionId === selectedSessionId) {
      timeline = loadedTimeline;
      timelineVisibleCount = 80;
    }
  }

  async function refreshPiTree(sessionId: string) {
    if (sessionId === archivingSessionId) return;
    const session = findSession(sessionId);
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
    const state = event.type === 'session.state_changed' ? event.payload.state : undefined;
    if (typeof state === 'string') {
      updateWorkspaceSessions(event.workspaceId, (items) =>
        items.map((session) =>
          session.id === event.sessionId ? { ...session, state: state as Session['state'] } : session,
        ),
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
      retryPrompt = latestUserPrompt(event.turnId);
      retryReason = stringPayload(event.payload.reason) ?? 'Agent 进程异常退出';
    }

    if (event.sessionId === selectedSessionId && event.type === 'usage.updated') {
      const usage = event.payload.usage;
      usageSnapshot = usage && typeof usage === 'object' && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)
        : null;
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
            toolName: null,
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
      const toolName = stringPayload(event.payload.itemType);
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
                toolName: toolName ?? item.toolName,
                content: delta
                  ? item.content + delta
                  : event.type === 'tool.started' || output
                    ? output ?? summary
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
            toolName,
            content: output ?? summary,
            status,
            createdAt: event.occurredAt,
            updatedAt: event.occurredAt,
          },
        ];
      }
    }

    if (event.sessionId === selectedSessionId && event.type === 'turn.failed') {
      retryPrompt = latestUserPrompt(event.turnId);
      retryReason = errorPayload(event.payload.error) ?? '本回合执行失败';
    }

    if (event.type === 'message.completed' || event.type === 'turn.completed' || event.type === 'turn.failed') {
      if (event.type === 'turn.completed' && event.payload.status !== 'failed' && event.payload.status !== 'interrupted') {
        retryPrompt = null;
        retryReason = null;
      }
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

  function errorPayload(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      const message = (value as Record<string, unknown>).message ?? (value as Record<string, unknown>).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return null;
  }

  function latestUserPrompt(turnId: string | null): string | null {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item.role === 'user' && (!turnId || item.turnId === turnId)) return item.content;
    }
    return lastSubmittedPrompt;
  }

  function usageValue(key: 'input' | 'output' | 'total'): number | null {
    if (!usageSnapshot) return null;
    const usage = usageSnapshot as Record<string, unknown>;
    const total = usage.total;
    if (key === 'total') {
      if (typeof usage.totalTokens === 'number') return usage.totalTokens;
      if (total && typeof total === 'object' && !Array.isArray(total)) {
        const value = (total as Record<string, unknown>).totalTokens;
        if (typeof value === 'number') return value;
      }
      return typeof total === 'number' ? total : null;
    }
    if (typeof usage[key] === 'number') return usage[key] as number;
    if (total && typeof total === 'object' && !Array.isArray(total)) {
      const value = (total as Record<string, unknown>)[`${key}Tokens`];
      if (typeof value === 'number') return value;
    }
    return null;
  }

  function isDiffContent(content: string): boolean {
    return /(^diff --git |^@@ |^\+\+\+ |^--- )/m.test(content);
  }

  function loadOlderTimeline() {
    timelineVisibleCount = Math.min(timeline.length, timelineVisibleCount + 80);
  }

  function handleTimelineScroll(event: Event) {
    const target = event.currentTarget as HTMLElement;
    if (target.scrollTop < 48 && hiddenTimelineCount > 0) loadOlderTimeline();
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

  async function createWorkspace(path: string) {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      errorMessage = '请选择一个已经存在的本地目录。';
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
      const workspace = await addWorkspace(normalizedPath);
      workspaces = [workspace, ...workspaces.filter(({ id }) => id !== workspace.id)];
      selectWorkspace(workspace.id);
      notice = '工作区已添加。首次运行 Agent 前请明确确认信任状态。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function chooseWorkspaceDirectory() {
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中使用系统目录选择器。';
      return;
    }

    busy = true;
    errorMessage = null;
    try {
      const selectedPath = await open({
        title: '选择工作区目录',
        directory: true,
        multiple: false,
        recursive: true,
        canCreateDirectories: false,
      });
      if (typeof selectedPath === 'string' && selectedPath.trim()) {
        await createWorkspace(selectedPath);
      }
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
      updateWorkspaceSessions(selectedWorkspace.id, (items) => [
        session,
        ...items.filter(({ id }) => id !== session.id),
      ]);
      selectedSessionId = session.id;
      timeline = [];
      usageSnapshot = null;
      retryPrompt = null;
      retryReason = null;
      lastSubmittedPrompt = null;
      createSessionWorkspaceId = null;
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
      updateWorkspaceSessions(selectedWorkspace.id, (items) => [
        session,
        ...items.filter(({ id }) => id !== session.id),
      ]);
      selectedSessionId = session.id;
      timeline = [];
      usageSnapshot = null;
      retryPrompt = null;
      retryReason = null;
      lastSubmittedPrompt = null;
      piTree = null;
      piNavigationEntryId = null;
      createSessionWorkspaceId = null;
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
      errorMessage = '已归档的会话不能继续发送消息，请先取消归档或创建分支。';
      return;
    }
    if (selectedSessionArchiving) {
      errorMessage = '该会话正在归档，请稍候。';
      return;
    }
    if (!desktop) {
      notice = '当前是 Web 预览；请在 Tauri 桌面模式中发送真实 Codex 请求。';
      return;
    }

    busy = true;
    errorMessage = null;
    lastSubmittedPrompt = input;
    promptInFlight = true;
    try {
      let session = selectedSession;
      if (!session) {
        session = await createCodexSession(selectedWorkspace.id);
        updateWorkspaceSessions(selectedWorkspace.id, (items) => [
          session as Session,
          ...items.filter(({ id }) => id !== session?.id),
        ]);
        selectedSessionId = session.id;
      }
      if (session.agent === 'pi') await sendPiPrompt(session.id, input);
      else await sendCodexPrompt(session.id, input);
      await refreshTimeline(session.id);
      composerText = '';
      updateWorkspaceSessions(session.workspaceId, (items) =>
        items.map((item) => item.id === session?.id ? { ...item, state: 'running' } : item),
      );
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      promptInFlight = false;
      busy = false;
    }
  }

  async function retryLastPrompt() {
    if (!retryPrompt || !selectedSession || sessionRunning || selectedSession.archived) return;
    composerText = retryPrompt;
    await sendPrompt();
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

  function requestPiTreeNavigation(entryId: string) {
    if (!selectedSession || selectedSession.agent !== 'pi' || sessionRunning || entryId === piTree?.leafId) return;
    piNavigationEntryId = entryId;
  }

  async function confirmPiTreeNavigation() {
    const entryId = piNavigationEntryId;
    const sessionId = selectedSessionId;
    piNavigationEntryId = null;
    if (!entryId || !sessionId || !selectedSession || selectedSession.agent !== 'pi') return;
    busy = true;
    errorMessage = null;
    try {
      const navigation = await navigatePiSessionTree(sessionId, entryId);
      if (navigation.cancelled) {
        notice = 'Pi 分支切换已取消。';
      } else {
        piTree = navigation;
        timeline = await getTimeline(sessionId);
        if (navigation.editorText !== null) composerText = navigation.editorText;
        notice = 'Pi 会话已切换到选定分支；原分支仍保留在会话树中。';
      }
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

  function beginRenameSession(sessionId = selectedSessionId) {
    const session = sessionId ? findSession(sessionId) : null;
    if (!session || !desktop || session.id === archivingSessionId) return;
    renamingSessionId = session.id;
    sessionLabelDraft = session.label;
  }

  function cancelRenameSession() {
    renamingSessionId = null;
    sessionLabelDraft = '';
  }

  async function saveSessionRename() {
    const sessionId = renamingSessionId;
    const label = sessionLabelDraft.trim();
    if (!sessionId || !label || !desktop) return;
    busy = true;
    errorMessage = null;
    try {
      const renamed = await renameSessionApi(sessionId, label);
      updateWorkspaceSessions(renamed.workspaceId, (items) =>
        items.map((item) => (item.id === renamed.id ? renamed : item)),
      );
      cancelRenameSession();
      notice = '会话名称已更新。';
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function closeSession(sessionId = selectedSessionId) {
    const target = sessionId ? findSession(sessionId) : null;
    if (!target || !desktop || target.id === archivingSessionId) return;
    busy = true;
    errorMessage = null;
    try {
      const closingId = target.id;
      const closingAgent = target.agent;
      if (target.agent === 'pi') await closePiSession(closingId);
      else await closeCodexSession(closingId);
      const remaining = getWorkspaceSessions(target.workspaceId).filter(({ id }) => id !== closingId);
      updateWorkspaceSessions(target.workspaceId, () => remaining);
      if (selectedSessionId === closingId) {
        selectedSessionId = remaining[0]?.id ?? null;
        codexThreadSnapshot = null;
        piTree = null;
        piNavigationEntryId = null;
        timeline = selectedSessionId ? await getTimeline(selectedSessionId) : [];
        if (selectedSessionId) void refreshPiTree(selectedSessionId);
      }
      notice = `${closingAgent === 'pi' ? 'Pi' : 'Codex'} 会话已关闭；已保存的时间线仍可在下次启动时读取。`;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function forkSession(sessionId = selectedSessionId) {
    const target = sessionId ? findSession(sessionId) : null;
    if (!target || !desktop || target.archived || target.id === archivingSessionId) return;
    if (isSessionRunning(target)) {
      errorMessage = '请等待当前 turn 完成后再创建分支。';
      return;
    }
    busy = true;
    errorMessage = null;
    try {
      const forked = await forkCodexThread(target.id);
      updateWorkspaceSessions(forked.workspaceId, (items) => [
        forked,
        ...items.filter(({ id }) => id !== forked.id),
      ]);
      activateWorkspace(forked.workspaceId);
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

  function requestArchiveSession(sessionId = selectedSessionId) {
    const target = sessionId ? findSession(sessionId) : null;
    if (!target || !desktop || target.archived || archivingSessionId !== null) return;
    if (isSessionRunning(target)) {
      errorMessage = '请等待当前 turn 完成后再归档。';
      return;
    }
    archiveConfirmationSessionId = target.id;
  }

  async function confirmArchiveSession() {
    const sessionId = archiveConfirmationSessionId;
    archiveConfirmationSessionId = null;
    if (!sessionId) return;
    const target = findSession(sessionId);
    if (!target || target.archived || archivingSessionId !== null) return;
    archivingSessionId = target.id;
    archivingWorkspaceId = target.workspaceId;
    errorMessage = null;
    try {
      const archived = await archiveSessionApi(sessionId);
      pendingApprovals = pendingApprovals.filter((item) => item.sessionId !== archived.id);
      codexThreadSnapshot = null;
      void refreshCodexThreads(archived.workspaceId);
      await refreshSessions(archived.workspaceId);
      notice = `${archived.agent === 'pi' ? 'Pi 会话' : 'Codex 线程'}已归档；本地时间线仍保留。`;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      if (archivingSessionId === sessionId) {
        archivingSessionId = null;
        archivingWorkspaceId = null;
      }
    }
  }

  async function unarchiveSession(sessionId = selectedSessionId) {
    const target = sessionId ? findSession(sessionId) : null;
    if (!target || !desktop || !target.archived) return;
    busy = true;
    errorMessage = null;
    try {
      const restored = await unarchiveSessionApi(target.id);
      activateWorkspace(restored.workspaceId);
      selectedSessionId = restored.id;
      timeline = await getTimeline(restored.id);
      if (restored.agent === 'codex') {
        void refreshCodexThread(restored.id, true);
        void refreshCodexThreads(restored.workspaceId);
      }
      await refreshSessions(restored.workspaceId);
      if (getWorkspaceSessions(restored.workspaceId).some((item) => item.id === restored.id)) {
        selectedSessionId = restored.id;
      }
      notice = `${restored.agent === 'pi' ? 'Pi 会话' : 'Codex 线程'}已取消归档，可以继续发送消息。`;
    } catch (error) {
      errorMessage = toErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function selectSession(id: string) {
    const session = findSession(id);
    if (!session || session.id === archivingSessionId) return;
    activateWorkspace(session.workspaceId);
    selectedSessionId = id;
    usageSnapshot = null;
    retryPrompt = null;
    retryReason = null;
    lastSubmittedPrompt = null;
    timelineVisibleCount = 80;
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
    if (workspace.id === archivingWorkspaceId) return;

    busy = true;
    errorMessage = null;
    try {
      await removeWorkspace(workspace.id);
      workspaces = workspaces.filter(({ id }) => id !== workspace.id);
      const { [workspace.id]: _removedSessions, ...remainingSessionMap } = workspaceSessionMap;
      workspaceSessionMap = remainingSessionMap;
      expandedWorkspaceIds = expandedWorkspaceIds.filter((id) => id !== workspace.id);
      selectedWorkspaceId = workspaces[0]?.id ?? null;
      timeline = [];
      codexThreads = [];
      codexThreadSnapshot = null;
      piTree = null;
      piNavigationEntryId = null;
      if (selectedWorkspaceId) {
        if (!expandedWorkspaceIds.includes(selectedWorkspaceId)) {
          expandedWorkspaceIds = [...expandedWorkspaceIds, selectedWorkspaceId];
        }
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

  function ensureWorkspaceExpanded(id: string) {
    if (!expandedWorkspaceIds.includes(id)) {
      expandedWorkspaceIds = [...expandedWorkspaceIds, id];
    }
  }

  function activateWorkspace(id: string) {
    const isCurrentWorkspace = id === selectedWorkspaceId;
    selectedWorkspaceId = id;
    ensureWorkspaceExpanded(id);
    if (!isCurrentWorkspace) {
      createSessionWorkspaceId = null;
      selectedSessionId = null;
      timeline = [];
      codexThreads = [];
      codexThreadSnapshot = null;
      piTree = null;
      piNavigationEntryId = null;
      if (desktop) {
        void refreshSessions(id);
        void refreshCodexThreads(id);
      }
    }
  }

  function selectWorkspace(id: string) {
    const workspaceExpanded = expandedWorkspaceIds.includes(id);
    activateWorkspace(id);
    if (workspaceExpanded) {
      expandedWorkspaceIds = expandedWorkspaceIds.filter((workspaceId) => workspaceId !== id);
      if (createSessionWorkspaceId === id) createSessionWorkspaceId = null;
    }
    notice = null;
  }

  function toggleSessionCreator(workspaceId: string) {
    activateWorkspace(workspaceId);
    createSessionWorkspaceId =
      createSessionWorkspaceId === workspaceId ? null : workspaceId;
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

  type TimelineRenderItem =
    | { kind: 'entry'; id: string; item: TimelineItem }
    | { kind: 'tool-group'; id: string; items: TimelineItem[] };

  function groupTimelineItems(items: TimelineItem[]): TimelineRenderItem[] {
    const grouped: TimelineRenderItem[] = [];
    let toolItems: TimelineItem[] = [];

    const flushTools = () => {
      if (toolItems.length === 1) {
        grouped.push({ kind: 'entry', id: toolItems[0].id, item: toolItems[0] });
      } else if (toolItems.length > 1) {
        grouped.push({ kind: 'tool-group', id: `tool-group-${toolItems[0].id}`, items: toolItems });
      }
      toolItems = [];
    };

    for (const item of items) {
      if (item.role === 'tool') {
        toolItems.push(item);
      } else {
        flushTools();
        grouped.push({ kind: 'entry', id: item.id, item });
      }
    }
    flushTools();
    return grouped;
  }

  function toolLabel(item: TimelineItem): string {
    const explicitName = item.toolName?.trim();
    const firstLine = item.content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!explicitName) return truncateToolLabel(firstLine ?? '工具操作');

    const friendlyName: Record<string, string> = {
      commandExecution: '命令执行',
      fileRead: '读取文件',
      fileChange: '修改文件',
      mcpToolCall: 'MCP 工具',
      webSearch: '网页搜索',
    };
    const label = friendlyName[explicitName] ?? explicitName.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (firstLine && firstLine !== explicitName && !firstLine.startsWith('{') && firstLine.length <= 64) {
      return truncateToolLabel(`${label} · ${firstLine}`);
    }
    return truncateToolLabel(label);
  }

  function truncateToolLabel(value: string): string {
    return value.length > 88 ? `${value.slice(0, 85)}…` : value;
  }

  function sessionStateLabel(session: Session): string {
    if (session.archived) return '已归档';
    switch (session.state) {
      case 'waiting_approval':
        return '待审批';
      case 'running':
        return '运行中';
      case 'interrupted':
        return '已中断';
      case 'failed':
        return '失败';
      case 'closed':
        return '已关闭';
      case 'starting':
        return '启动中';
      case 'created':
        return '新建';
      default:
        return '空闲';
    }
  }

  function sessionStatusTone(session: Session): string {
    if (session.archived || session.state === 'closed') return 'muted';
    if (session.state === 'running' || session.state === 'starting') return 'running';
    if (session.state === 'waiting_approval') return 'attention';
    if (session.state === 'failed' || session.state === 'interrupted') return 'danger';
    return 'idle';
  }

  function relativeTimeLabel(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 60) return '刚刚';
    if (elapsedSeconds < 60 * 60) return `${Math.floor(elapsedSeconds / 60)}分`;
    if (elapsedSeconds < 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (60 * 60))}时`;
    if (elapsedSeconds < 30 * 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (24 * 60 * 60))}天`;
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp);
  }

  function isSessionRunning(session: Session | null | undefined): boolean {
    return session?.state === 'running' || session?.state === 'waiting_approval';
  }
</script>

<svelte:head>
  <title>Aibo</title>
</svelte:head>

<div class="app-shell">
  <header class="window-titlebar" data-tauri-drag-region>
    <span class="window-title">Aibo</span>
    <div class="window-actions">
      <Button variant="ghost" size="icon" type="button" aria-label="打开设置" title="设置" onclick={() => (settingsOpen = true)}>
        <SettingsIcon size={16} />
      </Button>
    </div>
  </header>

  <main class="workspace-grid">
    <Card as="aside" class="sidebar" aria-label="工作区">
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
            onclick={() => (sessionSearchOpen = !sessionSearchOpen)}
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
            onclick={() => (sessionFilterOpen = !sessionFilterOpen)}
          >
            <ListFilterIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="添加工作区"
            title="添加工作区"
            onclick={() => void chooseWorkspaceDirectory()}
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
            void refreshExpandedSessions();
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
              onchange={() => {
                void refreshExpandedSessions();
              }}
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
            {@const workspaceSessions = workspaceSessionMap[workspace.id] ?? []}
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
                  onclick={() => selectWorkspace(workspace.id)}
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
                    onclick={(event) => { event.stopPropagation(); toggleSessionCreator(workspace.id); }}
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
                    onclick={(event) => { event.stopPropagation(); void toggleTrust(workspace); }}
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
                    onclick={(event) => { event.stopPropagation(); void deleteWorkspace(workspace); }}
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
                      <Button size="sm" type="button" onclick={() => void createCodex()} disabled={busy}>Codex</Button>
                      <Button variant="outline" size="sm" type="button" onclick={() => void createPi()} disabled={busy}>Pi</Button>
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
                                    void saveSessionRename();
                                  } else if (event.key === 'Escape') {
                                    cancelRenameSession();
                                  }
                                }}
                              />
                              <Button variant="outline" size="icon" type="button" aria-label="保存会话名称" title="保存" onclick={() => void saveSessionRename()} disabled={busy || !sessionLabelDraft.trim()}>
                                <CheckIcon size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" type="button" aria-label="取消改名" title="取消" onclick={cancelRenameSession} disabled={busy}>
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
                              onclick={() => selectSession(session.id)}
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
                                <Button variant="ghost" size="icon" type="button" aria-label="取消归档" title="取消归档" onclick={() => void unarchiveSession(session.id)} disabled={busy}>
                                  <ArchiveRestoreIcon size={13} />
                                </Button>
                              {:else if session.agent === 'codex'}
                                <Button variant="ghost" size="icon" type="button" aria-label="创建分支" title="分支" onclick={() => void forkSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                                  <GitBranchIcon size={13} />
                                </Button>
                                <Button variant="ghost" size="icon" type="button" aria-label="归档会话" title="归档" onclick={() => requestArchiveSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                                  <ArchiveIcon size={13} />
                                </Button>
                                <Button variant="ghost" size="icon" type="button" aria-label="关闭会话" title="关闭" onclick={() => void closeSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                                  <XIcon size={13} />
                                </Button>
                                <Button variant="ghost" size="icon" type="button" aria-label="读取线程" title="读取线程" onclick={() => void syncCodexThread(session.id)} disabled={threadBusy || busy || archivingSessionId === session.id}>
                                  <RefreshCwIcon size={13} />
                                </Button>
                              {:else}
                                <Button variant="ghost" size="icon" type="button" aria-label="归档会话" title="归档" onclick={() => requestArchiveSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId !== null}>
                                  <ArchiveIcon size={13} />
                                </Button>
                                <Button variant="ghost" size="icon" type="button" aria-label="关闭会话" title="关闭" onclick={() => void closeSession(session.id)} disabled={busy || isSessionRunning(session) || archivingSessionId === session.id}>
                                  <XIcon size={13} />
                                </Button>
                              {/if}
                              <Button variant="ghost" size="icon" type="button" aria-label="改名" title="改名" onclick={() => beginRenameSession(session.id)} disabled={busy || archivingSessionId === session.id}>
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

    <Card as="section" class="timeline" aria-label="会话时间线">
      <CardHeader class="panel-heading timeline-heading">
        <CardTitle>{selectedSession?.label ?? selectedWorkspace?.label ?? '选择工作区'}</CardTitle>
        <div class="timeline-heading-actions">
          {#if selectedSession}
            <Badge variant={sessionArchived ? 'secondary' : sessionRunning || selectedSessionArchiving ? 'warning' : 'outline'}>
              {selectedSessionArchiving ? '归档中' : sessionStateLabel(selectedSession)}
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
      {#if selectedWorkspace}
        <Separator />

        {#if usageSnapshot}
          <div class="usage-strip" aria-label="Token 使用量">
            <span>Token</span>
            {#if usageValue('input') !== null}<span>输入 {usageValue('input')}</span>{/if}
            {#if usageValue('output') !== null}<span>输出 {usageValue('output')}</span>{/if}
            {#if usageValue('total') !== null}<span>总计 {usageValue('total')}</span>{/if}
          </div>
        {/if}

        {#if retryPrompt && selectedSession && !sessionRunning && !sessionArchived}
          <div class="timeline-retry" role="status">
            <span>{retryReason ?? '上一回合未完成，可以重试。'}</span>
            <Button variant="outline" size="sm" type="button" onclick={() => void retryLastPrompt()} disabled={busy || selectedSessionArchiving}>重试上一条</Button>
          </div>
        {/if}

        {#if timeline.length > 0}
          <div class="timeline-feed" aria-live="polite" onscroll={handleTimelineScroll}>
            {#if hiddenTimelineCount > 0}
              <Button
                class="timeline-load-more"
                variant="ghost"
                size="sm"
                type="button"
                onclick={loadOlderTimeline}
              >加载更早的 {Math.min(hiddenTimelineCount, 80)} 条消息</Button>
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
                    <Badge variant={item.role === 'assistant' ? 'secondary' : item.role === 'tool' ? 'outline' : 'outline'}>{item.role === 'assistant' ? (selectedSession?.agent === 'pi' ? 'PI' : 'CODEX') : item.role.toUpperCase()}</Badge>
                    <Badge variant="outline">{item.status}</Badge>
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
                    <div class="entry-content">{item.content || '…'}</div>
                  {/if}
                </Card>
              {/if}
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

      {#if agentActivityLabel}
        <div class="agent-activity" role="status" aria-live="polite">
          <span class="activity-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          <span>{agentActivityLabel}</span>
        </div>
      {/if}

      <Card as="form" class="composer" onsubmit={(event) => { event.preventDefault(); void sendPrompt(); }}>
        <Textarea
          class="composer-textarea"
          bind:value={composerText}
          rows="2"
          placeholder={sessionArchived ? '该会话已归档，请取消归档或创建分支继续…' : selectedSession ? '输入消息，⌘/Ctrl + Enter 发送…' : '先新建或选择一个 Agent 会话…'}
          disabled={!selectedSession || sessionArchived || selectedSessionArchiving || (sessionRunning && selectedSession?.agent === 'codex') || busy}
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
          <Button size="icon" type="submit" disabled={!selectedSession || sessionArchived || selectedSessionArchiving || !composerText.trim() || busy} aria-label="发送">
            <SendIcon size={14} />
          </Button>
        {/if}
      </Card>
    </Card>

    <Card as="aside" class="inspector" aria-label="会话上下文">
      <CardHeader class="panel-heading">
        <CardTitle>上下文</CardTitle>
        {#if selectedSession}
          <Badge variant={sessionArchived ? 'secondary' : sessionRunning || selectedSessionArchiving ? 'warning' : 'outline'}>
            {selectedSessionArchiving ? '归档中' : sessionStateLabel(selectedSession)}
          </Badge>
        {:else}
          <Badge variant="secondary">未选择</Badge>
        {/if}
      </CardHeader>
      <Separator />

      {#if selectedSession}
        <Card class="session-context-card">
          <CardHeader class="session-context-heading">
            <div class="session-context-title">
              <span class={`session-agent session-agent-${selectedSession.agent}`}>{selectedSession.agent === 'pi' ? 'PI' : 'CX'}</span>
              <div>
                <CardTitle>{selectedSession.label}</CardTitle>
                <small>{selectedSession.agent === 'pi' ? 'Pi SDK host' : 'Codex app-server'}</small>
              </div>
            </div>
          </CardHeader>
          <CardContent class="session-context-content">
            <dl>
              <div><dt>会话 ID</dt><dd title={selectedSession.id}>{selectedSession.id}</dd></div>
              {#if selectedSession.externalSessionId}<div><dt>远端绑定</dt><dd title={selectedSession.externalSessionId}>{selectedSession.externalSessionId}</dd></div>{/if}
              <div><dt>更新时间</dt><dd>{selectedSession.updatedAt}</dd></div>
            </dl>
          </CardContent>
        </Card>
      {:else}
        <div class="inspector-empty">从左侧选择一个会话查看上下文。</div>
      {/if}

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
                    {#if entry.node.id !== piTree.leafId}
                      <Button variant="ghost" size="sm" type="button" onclick={() => requestPiTreeNavigation(entry.node.id)} disabled={busy || sessionRunning || selectedSessionArchiving}>切换</Button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <Button variant="ghost" size="sm" type="button" onclick={() => void refreshPiTree(selectedSession.id)} disabled={busy || selectedSessionArchiving}>
              <RefreshCwIcon size={13} /> 刷新会话树
            </Button>
          </CardContent>
        </Card>
      {/if}

      {#if selectedWorkspace}
        <Card class="trust-card">
          <div class="trust-card-heading"><ShieldCheckIcon size={16} /><strong>工作区信任</strong></div>
          <p>{selectedWorkspace.trust === 'trusted' ? '当前目录已允许 Agent 操作。' : '确认目录来源后再启用 Agent 操作。'}</p>
        </Card>
      {/if}

      <Separator />
      <div class="inspector-footer">
        <Button variant="ghost" size="sm" type="button" onclick={() => void refresh()} disabled={busy}>
          <RefreshCwIcon size={13} /> 刷新数据
        </Button>
      </div>
    </Card>
  </main>

  {#if settingsOpen}
    <div class="settings-overlay" role="presentation" onclick={() => (settingsOpen = false)}>
      <Card class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onclick={(event) => event.stopPropagation()}>
        <CardHeader class="settings-header">
          <div>
            <CardTitle id="settings-title">设置</CardTitle>
            <p>管理 Agent 连接状态与工作区运行信息。</p>
          </div>
          <Button variant="ghost" size="icon" type="button" aria-label="关闭设置" title="关闭" onclick={() => (settingsOpen = false)}>
            <XIcon size={16} />
          </Button>
        </CardHeader>
        <Separator />
        <div class="settings-content">
          <section class="settings-section" aria-labelledby="agent-diagnostics-title">
            <div class="settings-section-heading">
              <div>
                <h2 id="agent-diagnostics-title">Agent 状态</h2>
                <p>连接诊断仅在设置中展示，不占用会话工作区。</p>
              </div>
              <Badge variant={diagnostics.length > 0 && readyAgents === diagnostics.length ? 'success' : 'warning'}>{readyAgents}/{diagnostics.length} 就绪</Badge>
            </div>
            <div class="settings-agent-cards">
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
          </section>
          <Separator />
          <section class="settings-section" aria-labelledby="runtime-info-title">
            <div class="settings-section-heading">
              <div>
                <h2 id="runtime-info-title">运行环境</h2>
                <p>当前首发平台与本地工作区摘要。</p>
              </div>
            </div>
            <dl class="settings-runtime-list">
              <div><dt>平台</dt><dd>{desktop ? 'macOS · Tauri' : 'Web 预览'}</dd></div>
              <div><dt>工作区</dt><dd>{workspaces.length}</dd></div>
              <div><dt>会话</dt><dd>{sessions.length}</dd></div>
            </dl>
          </section>
        </div>
        <div class="settings-footer">
          <Button variant="outline" size="sm" type="button" onclick={() => void refresh()} disabled={busy}>
            <RefreshCwIcon size={13} /> 刷新诊断
          </Button>
          <Button size="sm" type="button" onclick={() => (settingsOpen = false)}>完成</Button>
        </div>
      </Card>
    </div>
  {/if}

  {#if errorMessage || notice}
    <div class="toast-region" aria-label="应用通知">
      {#if errorMessage}
        <Card class="toast error-toast" role="alert" aria-live="assertive" aria-atomic="true">
          {errorMessage}
        </Card>
      {/if}
      {#if notice}
        <Card class="toast notice-toast" role="status" aria-live="polite" aria-atomic="true">
          {notice}
        </Card>
      {/if}
    </div>
  {/if}
  <AlertDialog
    open={archiveConfirmationSessionId !== null}
    title="归档会话？"
    description="归档会隐藏会话，但不会删除 Aibo 中已保存的本地时间线。"
    confirmText="归档"
    cancelText="取消"
    onConfirm={() => void confirmArchiveSession()}
    onCancel={() => (archiveConfirmationSessionId = null)}
  />
  <AlertDialog
    open={piNavigationEntryId !== null}
    title="切换 Pi 分支？"
    description="切换只会移动 Pi 原生 session 的当前 leaf，不会删除 Aibo 已保存的时间线；切换后仍可返回其他分支。"
    confirmText="切换"
    cancelText="取消"
    onConfirm={() => void confirmPiTreeNavigation()}
    onCancel={() => (piNavigationEntryId = null)}
  />
</div>
