import type { ActionMessage, Snapshot } from './contract.ts';
import { projectGit, type GitPage } from './git.ts';
import { assertSnapshot } from './validation.ts';

/** Local host port, not part of the serializable public wire contract. */
export type GitPort = { open(workspaceId: string): Promise<GitPage>; act(message: ActionMessage): Promise<GitPage>; release(generation: string): Promise<void> };
export function createGitController(port: GitPort, publish: (snapshot: Snapshot | null) => void, timeoutMs = 15_000) {
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  let current: Snapshot | null = null;
  let sequence = 0;
  let workspace: string | null = null;
  let disposed = false;
  const emit = (value: Snapshot | null) => { if (value) assertSnapshot(value); current = value; publish(value); };
  async function open(workspaceId: string) {
    const ticket = ++sequence;
    workspace = workspaceId;
    const old = current?.context.generation;
    emit(null);
    if (old) void port.release(old).catch(() => {});
    try {
      let expired = false;
      const pending = port.open(workspaceId);
      void pending.then(page => { if (expired) void port.release(page.context.generation).catch(() => {}); }, () => {});
      let page: GitPage;
      try { page = await bounded(pending); }
      catch (error) { expired = true; throw error; }
      if (disposed || ticket !== sequence) { void port.release(page.context.generation).catch(() => {}); return; }
      try {
        if (page.context.workspaceId !== workspaceId || !page.context.generation || page.context.revision < 1) throw new Error('invalid_output: context');
        emit(projectGit(page));
      }
      catch (error) { void port.release(page.context.generation).catch(() => {}); throw error; }
    } catch (error) {
      if (disposed || ticket !== sequence) return;
      // No server generation exists yet; only reopening, never an action, is permitted.
      emit(projectGit({ context: { workspaceId, contributionId: 'dev.aibo.git.changes', generation: '', revision: 0 }, status: 'error', message: String(error).slice(0,8000), items: [], offset: 0, total: 0, truncated: false, detail: null }));
    }
  }
  async function act(message: ActionMessage) {
    if (!current || disposed) return;
    if (JSON.stringify(message.context) !== JSON.stringify(current.context)) return;
    if (message.actionId === 'refresh' && !current.context.generation && workspace) { await open(workspace); return; }
    const ticket = ++sequence;
    const previous = current;
    emit({ ...previous, state: { status: 'loading', message: '正在读取…' } });
    try {
      const result = await bounded(port.act(message));
      if (disposed || ticket !== sequence) return;
      if (result.context.workspaceId !== previous.context.workspaceId || result.context.generation !== previous.context.generation || result.context.contributionId !== previous.context.contributionId || result.context.revision <= previous.context.revision) throw new Error('invalid_output: action context');
      emit(projectGit(result));
    } catch (error) {
      if (disposed || ticket !== sequence) return;
      // A timed-out/expired lease can only be recovered by a fresh host read.
      emit({ ...previous, state: { status: 'error', message: `${String(error).slice(0,8000)}；请刷新重试。` } });
    }
  }
  return {
    open,
    act,
    refresh: () => workspace ? open(workspace) : Promise.resolve(),
    dispose() { disposed = true; ++sequence; const generation = current?.context.generation; emit(null); if (generation) void port.release(generation).catch(() => {}); },
  };
}
