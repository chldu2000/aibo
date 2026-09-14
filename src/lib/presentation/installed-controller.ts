import { assertSnapshot } from './validation.ts';
import type { ActionMessage, Snapshot } from './contract.ts';
export type InstalledScope = { kind: 'application' } | { kind: 'workspace' | 'session'; id: string };
export type InstalledContribution = { scope?: 'application' | 'workspace' | 'session'; extensionPoint?: string; visibility?: 'always' | 'workspaceSelected' | 'sessionSelected'; installationId: string; contributionId: string; title: string; available: boolean; issue: string | null };
export type InstalledPort = {
  open(workspaceId: string, installationId: string, contributionId: string, requestId: string, scope?: InstalledScope): Promise<Snapshot>;
  cancelOpen(requestId: string): Promise<void>;
  act(action: ActionMessage): Promise<Snapshot>;
  write?(action: ActionMessage, requestId: string): Promise<unknown>;
  release(generation: string): Promise<void>;
};
function failureMessage(error: unknown): string {
  const message = String(error);
  const reasons: [string, string][] = [
    ['permission_denied', '请确认工作区可信，且所选文件位于该工作区内。'],
    ['provider_unavailable', '插件或其依赖当前不可用，请检查是否已启用。'],
    ['provider_selection_required', '多个提供者符合此页面声明，请检查插件配置。'],
    ['stale_context', '页面已过期，请重新加载。'],
    ['busy', '工具正在执行其他操作，请稍后重试。'],
    ['timeout', '读取超时，请重新加载。'],
    ['cancelled', '读取已取消。'],
    ['invalid_output', '插件返回了无法显示的数据，请重新加载。'],
    ['invalid_snapshot', '插件返回了无法显示的数据，请重新加载。'],
  ];
  return reasons.find(([code]) => message.includes(code))?.[1] ?? '读取失败，请重新加载。';
}
export function createInstalledController(port: InstalledPort, publish: (snapshot: Snapshot | null, error: string) => void) {
  let current: Snapshot | null = null;
  let sequence = 0;
  let disposed = false;
  let pending: Promise<void> | null = null;
  const release = (generation?: string) => { if (generation) void port.release(generation).catch(() => {}); };
  async function open(workspaceId: string, contribution: InstalledContribution, scope: InstalledScope = {kind:"workspace",id:workspaceId}) {
    const ticket = ++sequence;
    release(current?.context.generation); current = null; publish(null, '');
    const requestId = crypto.randomUUID();
    const cancellation = setInterval(() => { if (disposed || ticket !== sequence) void port.cancelOpen(requestId).catch(() => {}); }, 100);
    try {
      const result = await port.open(workspaceId, contribution.installationId, contribution.contributionId, requestId, scope);
      if (disposed || ticket !== sequence) { release(result.context?.generation); return; }
      try {
        assertSnapshot(result);
        if ((scope.kind === "application" ? result.context.workspaceId !== null : result.context.workspaceId !== workspaceId) || (scope.kind === "session" && result.context.sessionId !== scope.id) || result.context.contributionId !== contribution.contributionId || !result.context.generation || result.context.revision < 1) throw Error('invalid_output: context');
      } catch (error) { release(result.context?.generation); throw error; }
      current = result; publish(result, '');
    } catch (error) { if (!disposed && ticket === sequence) publish(null, failureMessage(error)); }
    finally { clearInterval(cancellation); }
  }
  function act(message: ActionMessage): Promise<void> {
    if (pending) return pending;
    const operation = performAction(message);
    pending = operation;
    void operation.finally(() => { if (pending === operation) pending = null; });
    return operation;
  }
  async function performAction(message: ActionMessage) {
    if (disposed || !current || JSON.stringify(current.context) !== JSON.stringify(message.context)) return;
    const previous = current, ticket = ++sequence;
    const action = previous.actions.find(action => action.id === message.actionId && action.enabled);
    if (!action) return;
    const writing = action.intent === 'execute';
    let completed = false;
    publish({ ...previous, state: { status: 'loading', message: writing ? '等待批准或正在执行…' : '正在读取…' } }, '');
    try {
      if (writing) {
        if (!port.write) throw Error('write_unavailable');
        await port.write(message, crypto.randomUUID());
        completed = true;
        if (disposed || ticket !== sequence) return;
        if (!previous.actions.some(action => action.id === 'refresh' && action.enabled)) {
          keepWriteResult('写入已完成。重新打开页面可获取最新数据。');
          return;
        }
      }
      const result = await port.act(writing ? { context: previous.context, actionId: 'refresh', itemId: null } : message);
      if (disposed || ticket !== sequence) return;
      assertSnapshot(result);
      if (result.context.sessionId !== previous.context.sessionId || result.context.generation !== previous.context.generation || result.context.workspaceId !== previous.context.workspaceId || result.context.contributionId !== previous.context.contributionId || result.context.revision <= previous.context.revision) throw Error('invalid_output: context');
      current = result; publish(result, '');
    } catch (error) {
      if (!disposed && ticket === sequence) {
        if (writing) {
          const reason = String(error);
          keepWriteResult(completed ? '写入已完成，但刷新失败。请刷新页面查看结果。'
            : reason.includes('outcome_unknown') ? '写入结果未知。请查看执行历史并核实实际结果，勿直接重试。'
            : reason.includes('approval_rejected') ? '本次写入未获批准。刷新后可重新操作。'
            : '写入未完成。请查看执行历史，刷新页面后再操作。');
        } else { current = null; release(previous.context.generation); publish(null, failureMessage(error)); }
      }
    }
    function keepWriteResult(message: string) {
      current = { ...previous, actions: previous.actions.map(action => action.intent === 'execute' ? { ...action, enabled: false } : action) };
      publish(current, message);
    }
  }
  return { open, act, dispose() { disposed = true; ++sequence; release(current?.context.generation); current = null; } };
}
