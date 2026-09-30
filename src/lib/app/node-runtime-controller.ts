export type NodeRuntimeStatus = {
  selected: { path: string; version: string; source: 'system' | 'manual' | 'managed' } | null;
  manualPath: string | null;
  hostRequirement: string;
  downloadVersion: string;
  downloadSupported: boolean;
  issues: string[];
};
export type NodeRuntimeState = {
  value: NodeRuntimeStatus | null;
  pending: 'detect' | 'select' | 'download' | null;
  error: string | null;
  notice: string | null;
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
      if (!Array.isArray(value.issues) || typeof value.hostRequirement !== 'string') throw new Error('Node 检测返回了无效数据，请重试。');
      state = { ...state, value, notice: pending === 'detect' ? null : '设置已生效，新启动的插件进程将使用此选择。' };
      await ports.refreshDependencies();
    } catch (error) { state = { ...state, error: error instanceof Error ? error.message : String(error) }; }
    finally { state = { ...state, pending: null }; publish(); }
  }
  return {
    load: () => run('detect', () => ports.read(true)),
    choose: () => run('select', async () => { const path = await ports.pick(); return path === null ? null : ports.select(path); }),
    automatic: () => run('select', () => ports.select(null)),
    download: () => run('download', () => ports.download()),
  };
}
