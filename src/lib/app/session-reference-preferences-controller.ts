export type SessionReferencePreferences = { messageLimit: number | null };
export type SessionReferencePreferencesState = {
  value: SessionReferencePreferences | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
export const emptySessionReferencePreferences = (): SessionReferencePreferencesState => ({ value: null, loading: false, saving: false, error: null });

export function createSessionReferencePreferencesController(ports: {
  read(): Promise<SessionReferencePreferences>;
  save(messageLimit: number | null): Promise<SessionReferencePreferences>;
  changed(state: SessionReferencePreferencesState): void;
}) {
  let state = emptySessionReferencePreferences();
  let generation = 0;
  const publish = () => ports.changed({ ...state, value: state.value ? { ...state.value } : null });
  function validated(value: SessionReferencePreferences): SessionReferencePreferences {
    if (!value || !(value.messageLimit === null || (Number.isInteger(value.messageLimit) && value.messageLimit >= 1 && value.messageLimit <= 10000))) throw new Error('会话引用设置返回了无效数据，请重试。');
    return { messageLimit: value.messageLimit };
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
    async save(messageLimit: number | null) {
      if (!state.value || state.loading || state.saving) return;
      ++generation;
      state = { ...state, saving: true, error: null }; publish();
      try { validated({ messageLimit }); state = { ...state, value: validated(await ports.save(messageLimit)) }; }
      catch (error) { state = { ...state, error: message(error) }; }
      finally { state = { ...state, saving: false }; publish(); }
    },
  };
}
