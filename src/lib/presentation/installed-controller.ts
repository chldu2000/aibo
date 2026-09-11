import { assertSnapshot } from './validation.ts';
import type { ActionMessage, Snapshot } from './contract.ts';
export type InstalledScope = { kind: 'application' } | { kind: 'workspace' | 'session'; id: string };
export type InstalledContribution = { scope?: 'application' | 'workspace' | 'session'; extensionPoint?: string; visibility?: 'always' | 'workspaceSelected' | 'sessionSelected'; installationId: string; contributionId: string; title: string; available: boolean; issue: string | null };
export type InstalledPort = {
  open(workspaceId: string, installationId: string, contributionId: string, requestId: string, scope?: InstalledScope): Promise<Snapshot>;
  cancelOpen(requestId: string): Promise<void>;
  act(action: ActionMessage): Promise<Snapshot>;
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
  async function act(message: ActionMessage) {
    if (disposed || !current || JSON.stringify(current.context) !== JSON.stringify(message.context)) return;
    const previous = current, ticket = ++sequence;
    publish({ ...previous, state: { status: 'loading', message: '正在读取…' } }, '');
    try {
      const result = await port.act(message);
      if (disposed || ticket !== sequence) return;
      assertSnapshot(result);
      if (result.context.sessionId !== previous.context.sessionId || result.context.generation !== previous.context.generation || result.context.workspaceId !== previous.context.workspaceId || result.context.contributionId !== previous.context.contributionId || result.context.revision <= previous.context.revision) throw Error('invalid_output: context');
      current = result; publish(result, '');
    } catch (error) { if (!disposed && ticket === sequence) { current = null; release(previous.context.generation); publish(null, failureMessage(error)); } }
  }
  return { open, act, dispose() { disposed = true; ++sequence; release(current?.context.generation); current = null; } };
}
