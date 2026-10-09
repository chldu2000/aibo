import {projectTaskOutput} from './project-task-presentation.ts';
import type { ExecutionCursor, ProjectActionRun, WorkspaceWriteRun } from '../types';
import { toErrorText } from './error-utils.ts';
import { translate, localizedMessage } from '../../../packages/i18n/index.js';
import type { Locale, MessageKey, LocalizedText } from '../../../packages/i18n/index.js';

export type ExecutionEntry = {
  key: string; id: string; workspaceId: string; kind: 'task' | 'git'; title: LocalizedText;
  status: string; startedAt: string; completedAt: string | null; output: string;
  localizedOutput?: unknown; input?: string; caller?: string | null; stopRequested: boolean;
};
export type ExecutionHistoryState = { entries: ExecutionEntry[]; loading: boolean; errors: LocalizedText[]; stopping: string[]; page: number; hasOlder: boolean; hasNewer: boolean };
export const emptyExecutionHistory = (): ExecutionHistoryState => ({ entries: [], loading: false, errors: [], stopping: [], page: 1, hasOlder: false, hasNewer: false });
export const executionActive = (entry: ExecutionEntry) => ['awaiting_approval', 'running'].includes(entry.status);
export function executionStatus(entry: ExecutionEntry, locale: Locale = 'zh-CN'): string {
  if (executionActive(entry) && entry.stopRequested) return translate(locale, 'execution.status.stopRequested');
  const statusKeys: Record<string, MessageKey> = {
    awaiting_approval: 'execution.status.awaiting_approval', running: 'execution.status.running',
    rejected: 'execution.status.rejected', completed: 'execution.status.completed', failed: 'execution.status.failed',
    timed_out: 'execution.status.timed_out', outcome_unknown: 'execution.status.outcome_unknown',
  };
  return statusKeys[entry.status] ? translate(locale, statusKeys[entry.status]) : entry.status;
}
export function executionOutput(entry: ExecutionEntry, locale: Locale): string {
  return entry.kind === 'task' ? projectTaskOutput(entry.output,entry.localizedOutput,locale) : entry.output;
}
export function canStopExecution(entry: ExecutionEntry, windowId: string): boolean {
  return executionActive(entry) && !entry.stopRequested && (entry.kind === 'task' || entry.caller === windowId);
}
function taskEntry(run: ProjectActionRun): ExecutionEntry {
  return { key: `task:${run.id}`, id: run.id, workspaceId: run.workspaceId, kind: 'task', title: run.actionName ?? run.actionId, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, output: run.output, localizedOutput: run.localizedOutput, stopRequested: false };
}
function gitEntry(run: WorkspaceWriteRun): ExecutionEntry {
  const names: Record<string, LocalizedText> = { 'core.turn-restore': localizedMessage('execution.operation.core.turn-restore'), 'git.file-revert': localizedMessage('execution.operation.git.file-revert'), 'git.hunk': localizedMessage('execution.operation.git.hunk'), 'git.index': localizedMessage('execution.operation.git.index'), 'git.index-all': localizedMessage('execution.operation.git.index-all'), 'git.commit': localizedMessage('execution.operation.git.commit'), 'git.checkout': localizedMessage('execution.operation.git.checkout'), 'git.create-branch': localizedMessage('execution.operation.git.create-branch'), 'git.sync': localizedMessage('execution.operation.git.sync'), 'git.stash-apply': localizedMessage('execution.operation.git.stash-apply'), 'git.stash-push': localizedMessage('execution.operation.git.stash-push') };
  return { key: `git:${run.id}`, id: run.id, workspaceId: run.workspaceId, kind: 'git', title: names[run.operation] ?? run.operation, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, caller: run.callerWindow, input: JSON.stringify(run.snapshot.input, null, 2), output: run.result ? JSON.stringify(run.result, null, 2) : '', stopRequested: !!run.cancelRequestedAt };
}

// SQLite TEXT ordering is binary UTF-8, not locale-sensitive ordering.
function compareBytes(a: string, b: string): number {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) if (left[index] !== right[index]) return left[index] - right[index];
  return left.length - right.length;
}

/** Reading and stopping are owned by the host shell, never the active renderer. */
export function createExecutionHistoryController(ports: {
  readTasks(workspaceId: string, before: ExecutionCursor | null): Promise<ProjectActionRun[]>;
  readWrites(workspaceId: string, before: ExecutionCursor | null): Promise<WorkspaceWriteRun[]>;
  cancelTask(workspaceId: string, runId: string): Promise<boolean>;
  cancelWrite(workspaceId: string, runId: string): Promise<boolean>;
  publish(state: ExecutionHistoryState): void;
}, interval = 750) {
  type View = { before: ExecutionCursor | null; back: (ExecutionCursor | null)[]; workspaceId: string; windowId: string; state: ExecutionHistoryState; pending?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
  let current: View | undefined;
  const publish = (view: View) => { if (current === view) ports.publish({ ...view.state, entries: [...view.state.entries], stopping: [...view.state.stopping] }); };
  function close() { if (current) clearTimeout(current.timer); current = undefined; }
  function refresh(): Promise<void> {
    const view = current;
    if (!view) return Promise.resolve();
    if (view.pending) return view.pending;
    clearTimeout(view.timer);
    view.pending = (async () => {
      const results = await Promise.allSettled([ports.readTasks(view.workspaceId, view.before), ports.readWrites(view.workspaceId, view.before)]);
      if (current !== view) return;
      const entries: ExecutionEntry[] = []; const errors: LocalizedText[] = [];
      const rank = (status: string) => status === 'awaiting_approval' ? 0 : status === 'running' ? 1 : 2;
      for (const [index, result] of results.entries()) {
        const kind = index === 0 ? 'task' : 'git';
        if (result.status === 'rejected') {
          errors.push(localizedMessage(kind === 'task' ? 'execution.readTasksFailed' : 'execution.readWritesFailed', {error: toErrorText(result.reason)}));
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
      view.state = { ...view.state, entries: entries.sort((a, b) => compareBytes(b.startedAt, a.startedAt) || compareBytes(b.key, a.key)).slice(0, 20), hasOlder: errors.length === 0 && entries.length > 20, loading: false, errors };
      publish(view);
    })().finally(() => { view.pending = undefined; if (current === view) view.timer = setTimeout(() => void refresh(), interval); });
    return view.pending;
  }
  function openPage(workspaceId: string, windowId: string, before: ExecutionCursor | null, back: (ExecutionCursor | null)[]): Promise<void> {
    close(); current = { workspaceId, windowId, before, back, state: { ...emptyExecutionHistory(), loading: true, page: back.length + 1, hasNewer: back.length > 0 } };
    publish(current); return refresh();
  }
  return {
    close, refresh,
    open(workspaceId: string, windowId: string) {
      void openPage(workspaceId, windowId, null, []);
    },
    older(): Promise<void> {
      const view = current; const last = view?.state.entries.at(-1);
      if (!view || !last || view.state.loading || !view.state.hasOlder) return Promise.resolve();
      return openPage(view.workspaceId, view.windowId, { schema: 'aibo.execution-cursor/v1', workspaceId: view.workspaceId, startedAt: last.startedAt, kind: last.kind, id: last.id }, [...view.back, view.before]);
    },
    newer(): Promise<void> {
      const view = current; if (!view?.back.length) return Promise.resolve();
      return openPage(view.workspaceId, view.windowId, view.back.at(-1) ?? null, view.back.slice(0, -1));
    },
    latest(): Promise<void> { const view = current; return view ? openPage(view.workspaceId, view.windowId, null, []) : Promise.resolve(); },
    async stop(key: string): Promise<void> {
      const view = current; const entry = view?.state.entries.find(item => item.key === key);
      if (!view || !entry || !canStopExecution(entry, view.windowId) || view.state.stopping.includes(key)) return;
      view.state.stopping.push(key); publish(view);
      try {
        const requested = await (entry.kind === 'git' ? ports.cancelWrite : ports.cancelTask)(view.workspaceId, entry.id);
        if (current !== view) return;
        if (requested) view.state.entries = view.state.entries.map(item => item.key === key ? { ...item, stopRequested: true } : item);
      } catch (error) {
        if (current === view) view.state.errors = [...view.state.errors, localizedMessage('execution.stopFailed', {error: toErrorText(error)})];
      } finally {
        view.state.stopping = view.state.stopping.filter(item => item !== key); publish(view);
      }
    },
  };
}
