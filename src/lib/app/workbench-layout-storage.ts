export type WorkbenchLayoutState = {
  navigationWidth: number;
  auxiliaryWidth: number;
  auxiliaryOpen: boolean;
  activeView: 'git' | 'context';
};
type StoragePort = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const key = (windowId: string) => `aibo.workbench-layout.v1.${encodeURIComponent(windowId)}`;
export const defaultWorkbenchLayout = (): WorkbenchLayoutState => ({ navigationWidth: 260, auxiliaryWidth: 340, auxiliaryOpen: true, activeView: 'git' });
function normalize(value: unknown): WorkbenchLayoutState {
  const defaults = defaultWorkbenchLayout();
  if (!value || typeof value !== 'object') return defaults;
  const record = value as Record<string, unknown>;
  const width = (value: unknown, min: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(4096, value)) : fallback;
  return {
    navigationWidth: width(record.navigationWidth, 180, defaults.navigationWidth),
    auxiliaryWidth: width(record.auxiliaryWidth, 220, defaults.auxiliaryWidth),
    auxiliaryOpen: typeof record.auxiliaryOpen === 'boolean' ? record.auxiliaryOpen : defaults.auxiliaryOpen,
    activeView: record.activeView === 'context' ? 'context' : 'git',
  };
}
export function readWorkbenchLayout(storage: Pick<StoragePort, 'getItem'> | null, windowId: string): WorkbenchLayoutState {
  try { return normalize(JSON.parse(storage?.getItem(key(windowId)) ?? 'null')); }
  catch { return defaultWorkbenchLayout(); }
}
export function writeWorkbenchLayout(storage: Pick<StoragePort, 'setItem'> | null, windowId: string, state: WorkbenchLayoutState): void {
  try { storage?.setItem(key(windowId), JSON.stringify(normalize(state))); }
  catch { /* Live host layout remains usable when storage is unavailable. */ }
}
