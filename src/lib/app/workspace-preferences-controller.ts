export type WorkspacePreferences = { trustNewWorkspaces: boolean };
export type WorkspacePreferencesState = {
  value: WorkspacePreferences | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
export const emptyWorkspacePreferences = (): WorkspacePreferencesState => ({ value: null, loading: false, saving: false, error: null });

export function createWorkspacePreferencesController(ports: {
  read(): Promise<WorkspacePreferences>;
  save(trustNewWorkspaces: boolean): Promise<WorkspacePreferences>;
  changed(state: WorkspacePreferencesState): void;
}) {
  let state = emptyWorkspacePreferences();
  let generation = 0;
  const publish = () => ports.changed({ ...state, value: state.value ? { ...state.value } : null });
  function validated(value: WorkspacePreferences): WorkspacePreferences {
    if (!value || typeof value.trustNewWorkspaces !== 'boolean') throw new Error('工作区设置返回了无效数据，请重试。');
    return { trustNewWorkspaces: value.trustNewWorkspaces };
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
    async save(trustNewWorkspaces: boolean) {
      if (!state.value || state.loading || state.saving) return;
      ++generation;
      state = { ...state, saving: true, error: null }; publish();
      try { state = { ...state, value: validated(await ports.save(trustNewWorkspaces)) }; }
      catch (error) { state = { ...state, error: message(error) }; }
      finally { state = { ...state, saving: false }; publish(); }
    },
  };
}
