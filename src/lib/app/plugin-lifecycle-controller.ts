export type PluginReference = { id: string; label: string };
export type PluginRemovalImpact = {
  id: string; token: string; sessions: PluginReference[]; dependencies: PluginReference[];
  bindings: PluginReference[]; active: number; targets: PluginReference[];
};
export type PluginMigrationReport = { migrated: string[]; failed: PluginReference[] };
export type PluginLifecycleState = {
  impact: PluginRemovalImpact | null; busy: boolean;
  report: PluginMigrationReport | null; error: string;
};

export function createPluginLifecycleController(ports: {
  preview(id: string): Promise<PluginRemovalImpact>;
  remove(id: string, token: string, keepHistory: boolean): Promise<void>;
  migrate(id: string, target: string): Promise<PluginMigrationReport>;
  refresh(): Promise<void>;
  publish(state: PluginLifecycleState): void;
}) {
  let state: PluginLifecycleState = { impact: null, busy: false, report: null, error: '' };
  let revision = 0;
  const emit = () => ports.publish({ ...state });
  async function run(operation: () => Promise<void>) {
    if (state.busy) return;
    state = { ...state, busy: true, error: '' }; emit();
    try { await operation(); }
    catch (error) { state.error = String(error instanceof Error ? error.message : error); }
    finally { state.busy = false; emit(); }
  }
  return {
    review: (id: string) => run(async () => {
      const ticket = ++revision; state.impact = null; state.report = null;
      const impact = await ports.preview(id);
      if (revision === ticket) state.impact = impact;
    }),
    reviewUpgrade: (target: string, sources: string[]) => run(async () => {
      for (const id of sources) {
        const impact = await ports.preview(id);
        if (impact.sessions.length && impact.targets.some(item => item.id === target)) {
          state.impact = impact;
          return;
        }
      }
    }),
    cancel() { if (state.busy) return; ++revision; state.impact = null; state.error = ''; emit(); },
    report(report: PluginMigrationReport) { state.report = report; emit(); },
    migrate: (target: string) => run(async () => {
      const impact = state.impact;
      if (!impact || !impact.targets.some(item => item.id === target)) return;
      state.report = await ports.migrate(impact.id, target);
      await ports.refresh();
      state.impact = await ports.preview(impact.id);
    }),
    remove: (keepHistory: boolean) => run(async () => {
      const impact = state.impact;
      if (!impact || impact.dependencies.length || (!keepHistory && (impact.sessions.length || impact.bindings.length))) return;
      try {
        await ports.remove(impact.id, impact.token, keepHistory);
        state.impact = null;
        await ports.refresh();
      } catch (error) {
        // A stale confirmation cannot be reused after the host reports a changed reference set.
        state.impact = null;
        await ports.refresh();
        throw error;
      }
    }),
  };
}
