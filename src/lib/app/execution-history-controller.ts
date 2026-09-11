import type { ProjectActionRun, WorkspaceWriteRun } from '../types';
import { toErrorMessage } from './error-utils';

export type ExecutionEntry = {
  key: string; id: string; workspaceId: string; kind: 'task' | 'git'; title: string;
  status: string; startedAt: string; completedAt: string | null; output: string;
  input?: string; caller?: string | null; stopRequested: boolean;
};
export type ExecutionHistoryState = { entries: ExecutionEntry[]; loading: boolean; errors: string[]; stopping: string[] };
export const emptyExecutionHistory = (): ExecutionHistoryState => ({ entries: [], loading: false, errors: [], stopping: [] });
export const executionActive = (entry: ExecutionEntry) => ['awaiting_approval', 'running'].includes(entry.status);
export function executionStatus(entry: ExecutionEntry): string {
  if (executionActive(entry) && entry.stopRequested) return '已请求停止';
  return ({ awaiting_approval: '等待宿主批准', running: '执行中', rejected: '未执行', completed: '已结束', failed: '执行失败', timed_out: '执行超时', outcome_unknown: '结果未知，请核对实际更改' } as Record<string, string>)[entry.status] ?? entry.status;
}
export function canStopExecution(entry: ExecutionEntry, windowId: string): boolean {
  return executionActive(entry) && !entry.stopRequested && (entry.kind === 'task' || entry.caller === windowId);
}
function taskEntry(run: ProjectActionRun): ExecutionEntry {
  return { key: `task:${run.id}`, id: run.id, workspaceId: run.workspaceId, kind: 'task', title: run.actionName ?? run.actionId, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, output: run.output, stopRequested: false };
}
function gitEntry(run: WorkspaceWriteRun): ExecutionEntry {
  const names: Record<string, string> = { 'git.index': '文件暂存', 'git.index-all': '整体暂存', 'git.commit': '提交', 'git.checkout': '切换分支', 'git.create-branch': '创建分支', 'git.sync': '远程同步', 'git.stash-apply': '应用暂存记录', 'git.stash-push': '保存暂存记录' };
  return { key: `git:${run.id}`, id: run.id, workspaceId: run.workspaceId, kind: 'git', title: names[run.operation] ?? run.operation, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, caller: run.callerWindow, input: JSON.stringify(run.snapshot.input, null, 2), output: run.result ? JSON.stringify(run.result, null, 2) : '', stopRequested: !!run.cancelRequestedAt };
}

/** Reading and stopping are owned by the host shell, never the active renderer. */
export function createExecutionHistoryController(ports: {
  readTasks(workspaceId: string): Promise<ProjectActionRun[]>;
  readWrites(workspaceId: string): Promise<WorkspaceWriteRun[]>;
  cancelTask(workspaceId: string, runId: string): Promise<boolean>;
  cancelWrite(workspaceId: string, runId: string): Promise<boolean>;
  publish(state: ExecutionHistoryState): void;
}, interval = 750) {
  type View = { workspaceId: string; windowId: string; state: ExecutionHistoryState; pending?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
  let current: View | undefined;
  const publish = (view: View) => { if (current === view) ports.publish({ ...view.state, entries: [...view.state.entries], stopping: [...view.state.stopping] }); };
  function close() { if (current) clearTimeout(current.timer); current = undefined; }
  function refresh(): Promise<void> {
    const view = current;
    if (!view) return Promise.resolve();
    if (view.pending) return view.pending;
    clearTimeout(view.timer);
    view.pending = (async () => {
      const results = await Promise.allSettled([ports.readTasks(view.workspaceId), ports.readWrites(view.workspaceId)]);
      if (current !== view) return;
      const entries: ExecutionEntry[] = []; const errors: string[] = [];
      const rank = (status: string) => status === 'awaiting_approval' ? 0 : status === 'running' ? 1 : 2;
      for (const [index, result] of results.entries()) {
        const kind = index === 0 ? 'task' : 'git';
        if (result.status === 'rejected') {
          errors.push(`${kind === 'task' ? '工程任务' : 'Git'}记录读取失败：${toErrorMessage(result.reason)}`);
          entries.push(...view.state.entries.filter(entry => entry.kind === kind));
        } else {
          const next = index === 0 ? (result.value as ProjectActionRun[]).map(taskEntry) : (result.value as WorkspaceWriteRun[]).map(gitEntry);
          for (const entry of next) {
            if (entry.workspaceId !== view.workspaceId) continue;
            const old = view.state.entries.find(item => item.key === entry.key);
            entries.push(old && rank(old.status) > rank(entry.status) ? old : { ...entry, stopRequested: entry.stopRequested || !!old?.stopRequested });
          }
        }
      }
      view.state = { ...view.state, entries: entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.key.localeCompare(a.key)), loading: false, errors };
      publish(view);
    })().finally(() => { view.pending = undefined; if (current === view) view.timer = setTimeout(() => void refresh(), interval); });
    return view.pending;
  }
  return {
    close, refresh,
    open(workspaceId: string, windowId: string) {
      close(); current = { workspaceId, windowId, state: { ...emptyExecutionHistory(), loading: true } };
      publish(current); void refresh();
    },
    async stop(key: string): Promise<void> {
      const view = current; const entry = view?.state.entries.find(item => item.key === key);
      if (!view || !entry || !canStopExecution(entry, view.windowId) || view.state.stopping.includes(key)) return;
      view.state.stopping.push(key); publish(view);
      try {
        const requested = await (entry.kind === 'git' ? ports.cancelWrite : ports.cancelTask)(view.workspaceId, entry.id);
        if (current !== view) return;
        if (requested) view.state.entries = view.state.entries.map(item => item.key === key ? { ...item, stopRequested: true } : item);
      } catch (error) {
        if (current === view) view.state.errors = [...view.state.errors, `停止请求失败：${toErrorMessage(error)}`];
      } finally {
        view.state.stopping = view.state.stopping.filter(item => item !== key); publish(view);
      }
    },
  };
}
