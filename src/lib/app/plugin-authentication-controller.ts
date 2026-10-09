import type { LocalizedText } from '../../../packages/i18n/index.js';
import { toErrorText } from './error-utils.ts';
export type PluginAuthenticationResult = 'loginOpened' | 'authenticated' | 'unauthenticated';
export type PluginAuthenticationState = {
  busyId: string | null;
  entries: Record<string, { result?: PluginAuthenticationResult; error: LocalizedText }>;
};
export const emptyPluginAuthentication = (): PluginAuthenticationState => ({ busyId: null, entries: {} });

export function createPluginAuthenticationController(ports: {
  execute(id: string, action: 'login' | 'status'): Promise<PluginAuthenticationResult>;
  publish(state: PluginAuthenticationState): void;
}) {
  let state = emptyPluginAuthentication();
  const emit = () => ports.publish({ ...state, entries: { ...state.entries } });
  return {
    async run(id: string, action: 'login' | 'status') {
      if (state.busyId) return;
      state.busyId = id;
      state.entries[id] = { error: '' };
      emit();
      try {
        const result = await ports.execute(id, action);
        state.entries[id] = { result, error: '' };
      } catch (error) {
        state.entries[id] = { error: toErrorText(error) };
      } finally { state.busyId = null; emit(); }
    },
  };
}
