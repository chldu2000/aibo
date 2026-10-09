import { localizedMessage } from '../../../packages/i18n/index.js';
import { LocalizedError, readNativeMessage, toErrorText } from './error-utils.ts';
import type { LocalizedText } from '../../../packages/i18n/index.js';
export type NodeRuntimeStatus = {
  selected: { path: string; version: string; source: 'system' | 'manual' | 'managed' } | null;
  manualPath: string | null;
  hostRequirement: string;
  downloadVersion: string;
  downloadSupported: boolean;
  issues: string[];
  localizedIssues?: unknown[];
};
/** Native metadata is optional; legacy or malformed diagnostics retain their original text. */
export function nodeRuntimeIssueMessages(status: NodeRuntimeStatus): LocalizedText[] {
  const messages = status.localizedIssues;
  return status.issues.map((issue, index) => Array.isArray(messages) && messages.length === status.issues.length
    ? readNativeMessage(messages[index]) ?? issue : issue);
}
export type NodeRuntimeState = {
  value: NodeRuntimeStatus | null;
  pending: 'detect' | 'select' | 'download' | null;
  error: LocalizedText | null;
  notice: LocalizedText | null;
};
export const emptyNodeRuntime = (): NodeRuntimeState => ({ value: null, pending: null, error: null, notice: null });
export function createNodeRuntimeController(ports: {
  read(refresh: boolean): Promise<NodeRuntimeStatus>;
  select(path: string | null): Promise<NodeRuntimeStatus>;
  download(): Promise<NodeRuntimeStatus>;
  pick(): Promise<string | null>;
  refreshDependencies(): Promise<void>;
  changed(state: NodeRuntimeState): void;
}) {
  let state = emptyNodeRuntime();
  const publish = () => ports.changed({ ...state });
  async function run(pending: NonNullable<NodeRuntimeState['pending']>, operation: () => Promise<NodeRuntimeStatus | null>) {
    if (state.pending) return;
    state = { ...state, pending, error: null, notice: null }; publish();
    try {
      const value = await operation();
      if (!value) return;
      if (!Array.isArray(value.issues) || typeof value.hostRequirement !== 'string') throw new LocalizedError('error.nodeStatus');
      state = { ...state, value, notice: pending === 'detect' ? null : localizedMessage('node.selectionApplied') };
      await ports.refreshDependencies();
    } catch (error) { state = { ...state, error: toErrorText(error) }; }
    finally { state = { ...state, pending: null }; publish(); }
  }
  return {
    load: () => run('detect', () => ports.read(true)),
    choose: () => run('select', async () => { const path = await ports.pick(); return path === null ? null : ports.select(path); }),
    automatic: () => run('select', () => ports.select(null)),
    download: () => run('download', () => ports.download()),
  };
}
