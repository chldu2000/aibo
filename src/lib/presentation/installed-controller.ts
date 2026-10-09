import { readNativeMessage } from '../app/error-utils.ts';
import { localizedMessage } from '../../../packages/i18n/index.js';
import type { LocalizedText, MessageKey } from '../../../packages/i18n/index.js';
import { assertSnapshot } from './validation.ts';
import type { ActionMessage, Snapshot } from './contract.ts';
export type InstalledScope = { kind: 'application' } | { kind: 'workspace' | 'session'; id: string };
export type InstalledContribution = { scope?: 'application' | 'workspace' | 'session'; extensionPoint?: string; visibility?: 'always' | 'workspaceSelected' | 'sessionSelected'; installationId: string; contributionId: string; title: string; available: boolean; issue: string | null; localizedIssue?: unknown };
export type InstalledPort = {
  open(workspaceId: string, installationId: string, contributionId: string, requestId: string, scope?: InstalledScope): Promise<Snapshot>;
  cancelOpen(requestId: string): Promise<void>;
  act(action: ActionMessage): Promise<Snapshot>;
  write?(action: ActionMessage, requestId: string): Promise<unknown>;
  release(generation: string): Promise<void>;
};
function protocolCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) return typeof error.code === 'string' ? error.code : null;
  const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : null;
  return message?.match(/^([a-z_]+)(?::|$)/)?.[1] ?? null;
}
function nativeDisplay(error: unknown): LocalizedText | null {
  return error && typeof error === 'object' && 'localized' in error ? readNativeMessage(error.localized) : null;
}
function failureMessage(error: unknown): LocalizedText {
  const display = nativeDisplay(error);
  if (display) return display;
  const code = protocolCode(error);
  const reasons: [string, MessageKey][] = [
    ['permission_denied', 'installed.permissionDenied'],
    ['provider_unavailable', 'installed.providerUnavailable'],
    ['provider_selection_required', 'installed.providerSelectionRequired'],
    ['stale_context', 'installed.staleContext'],
    ['busy', 'installed.busy'],
    ['timeout', 'installed.timeout'],
    ['cancelled', 'installed.cancelled'],
    ['invalid_output', 'installed.invalidOutput'],
    ['invalid_snapshot', 'installed.invalidOutput'],
  ];
  return localizedMessage(reasons.find(([reason]) => code === reason)?.[1] ?? 'installed.readFailed');
}
export function createInstalledController(port: InstalledPort, publish: (snapshot: Snapshot | null, error: LocalizedText, hostMessage?: LocalizedText) => void) {
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
    publish({ ...previous, state: { status: 'loading', message: '' } }, '', localizedMessage(writing ? 'installed.writing' : 'installed.reading'));
    try {
      if (writing) {
        if (!port.write) throw Error('write_unavailable');
        await port.write(message, crypto.randomUUID());
        completed = true;
        if (disposed || ticket !== sequence) return;
        if (!previous.actions.some(action => action.id === 'refresh' && action.enabled)) {
          keepWriteResult(localizedMessage('installed.writeCompleted'));
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
          const code = protocolCode(error);
          const display = nativeDisplay(error);
          keepWriteResult(completed ? localizedMessage('installed.writeRefreshFailed')
            : code === 'outcome_unknown' ? display ? localizedMessage('installed.writeUnknownDetail', {error:display}) : localizedMessage('installed.writeUnknown')
            : code === 'approval_rejected' ? localizedMessage('installed.writeRejected')
            : display ?? localizedMessage('installed.writeFailed'));
        } else { current = null; release(previous.context.generation); publish(null, failureMessage(error)); }
      }
    }
    function keepWriteResult(message: LocalizedText) {
      current = { ...previous, actions: previous.actions.map(action => action.intent === 'execute' ? { ...action, enabled: false } : action) };
      publish(current, message);
    }
  }
  return { open, act, dispose() { disposed = true; ++sequence; release(current?.context.generation); current = null; } };
}
