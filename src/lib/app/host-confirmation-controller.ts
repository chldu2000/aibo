export const hostConfirmationCategories = [
  { id: 'git', label: 'Git 操作', description: '提交、暂存、回退、分支、远程同步与 Stash。' },
  { id: 'projectAction', label: '工程动作', description: '运行 Test、Lint、Build 和自定义命令。' },
  { id: 'turnRestore', label: '恢复本轮变更', description: '恢复会话中整个回合的文件修改。' },
  { id: 'capabilityWrite', label: '插件能力写入', description: '通过宿主调用插件提供的写入能力。' },
  { id: 'viewWrite', label: '插件视图写入', description: '执行插件视图中的写入操作。' },
] as const;
export type HostConfirmationCategory = typeof hostConfirmationCategories[number]['id'];
export type HostConfirmationPolicy = 'always-allow' | 'ask';
export type HostConfirmationPreferences = Record<HostConfirmationCategory, HostConfirmationPolicy>;
export type HostConfirmationState = {
  value: HostConfirmationPreferences | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
export const emptyHostConfirmation = (): HostConfirmationState => ({ value: null, loading: false, saving: false, error: null });

export function createHostConfirmationController(ports: {
  read(): Promise<HostConfirmationPreferences>;
  save(category: HostConfirmationCategory, policy: HostConfirmationPolicy): Promise<HostConfirmationPreferences>;
  changed(state: HostConfirmationState): void;
}) {
  let state = emptyHostConfirmation();
  let generation = 0;
  const publish = () => ports.changed({ ...state, value: state.value ? { ...state.value } : null });
  function validated(value: HostConfirmationPreferences): HostConfirmationPreferences {
    if (!value || !hostConfirmationCategories.every(({ id }) => value[id] === 'always-allow' || value[id] === 'ask')) {
      throw new Error('宿主操作确认设置返回了无效数据，请重试。');
    }
    return { ...value };
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  return {
    async load() {
      if (state.saving) return;
      const ticket = ++generation;
      state = { ...state, loading: true, error: null }; publish();
      try {
        const value = validated(await ports.read());
        if (ticket === generation) state = { ...state, value };
      } catch (error) {
        if (ticket === generation) state = { ...state, value: null, error: message(error) };
      } finally {
        if (ticket === generation) { state = { ...state, loading: false }; publish(); }
      }
    },
    async save(category: HostConfirmationCategory, policy: HostConfirmationPolicy) {
      if (!state.value || state.loading || state.saving) return;
      ++generation;
      state = { ...state, saving: true, error: null }; publish();
      try { state = { ...state, value: validated(await ports.save(category, policy)) }; }
      catch (error) { state = { ...state, error: message(error) }; }
      finally { state = { ...state, saving: false }; publish(); }
    },
  };
}
