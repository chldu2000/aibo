import { localizedMessage, type LocalizedText } from '../../../packages/i18n/index.js';
import { toErrorText } from './error-utils.ts';
export type DiagnosticLogStatus = { directory: string | null; state: 'initializing' | 'healthy' | 'degraded'; error_code: string | null; dropped: number; shutdown_complete: boolean };
export type DiagnosticLogsState = { status: DiagnosticLogStatus | null; loading: boolean; opening: boolean; error: LocalizedText | null };
export const emptyDiagnosticLogs = (): DiagnosticLogsState => ({ status: null, loading: false, opening: false, error: null });
export function diagnosticLogReason(code: string): LocalizedText {
  switch (code) {
    case 'permission_denied': return localizedMessage('diagnostics.logs.permissionDenied');
    case 'storage_full': return localizedMessage('diagnostics.logs.storageFull');
    case 'quota_exhausted': return localizedMessage('diagnostics.logs.quotaExhausted');
    case 'unsafe_directory': return localizedMessage('diagnostics.logs.unsafeDirectory');
    case 'shutdown_timeout': return localizedMessage('diagnostics.logs.shutdownTimeout');
    default: return localizedMessage('diagnostics.logs.ioError');
  }
}
export function createDiagnosticLogsController(ports: { read(): Promise<DiagnosticLogStatus>; open(): Promise<void>; publish(state: DiagnosticLogsState): void }) {
  let state = emptyDiagnosticLogs();
  const publish = () => ports.publish({ ...state });
  return {
    async load() {
      if (state.loading) return;
      state = { ...state, loading: true }; publish();
      try {
        const status = await ports.read();
        if (!status || !['initializing', 'healthy', 'degraded'].includes(status.state) || !Number.isSafeInteger(status.dropped) || status.dropped < 0 || status.directory !== null && typeof status.directory !== 'string') {
          state = { ...state, error: localizedMessage('diagnostics.logs.unavailable') }; return;
        }
        state = { ...state, status, error: null };
      }
      catch (error) { state = { ...state, error: toErrorText(error) }; }
      finally { state = { ...state, loading: false }; publish(); }
    },
    async open() {
      if (state.opening) return;
      state = { ...state, opening: true, error: null }; publish();
      try { await ports.open(); }
      catch (error) { state = { ...state, error: toErrorText(error) }; }
      finally { state = { ...state, opening: false }; publish(); }
    },
  };
}
