import type { LocalizedText } from '../../../packages/i18n/index.js';
import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';
import { readNativeMessage, toErrorText } from './error-utils.ts';
export type PluginReference = { id: string; label: string; localizedLabel?: unknown };
export type PluginRemovalImpact = {
  id: string; token: string; sessions: PluginReference[]; dependencies: PluginReference[];
  bindings: PluginReference[]; active: number; targets: PluginReference[];
};
export type PluginMigrationReport = { migrated: string[]; failed: PluginReference[] };
export type PluginLifecycleState = {
  impact: PluginRemovalImpact | null; busy: boolean;
  report: PluginMigrationReport | null; error: LocalizedText;
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
    catch (error) { state.error = toErrorText(error); }
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

/** Resolve display metadata without changing the controller's confirmation references. */
export function pluginRemovalImpactPresentation(impact: PluginRemovalImpact | null, locale: Locale): PluginRemovalImpact | null {
  if (!impact) return null;
  const references = (items: PluginReference[]) => pluginReferencesPresentation(items,locale);
  return {...impact,sessions:references(impact.sessions),dependencies:references(impact.dependencies),bindings:references(impact.bindings),targets:references(impact.targets)};
}

function pluginReferencesPresentation(items: PluginReference[], locale: Locale): PluginReference[] {
  return items.map(({localizedLabel, ...item}) => ({...item,label:translateMessage(locale,readNativeMessage(localizedLabel) ?? item.label)}));
}
export function pluginMigrationReportPresentation(report: PluginMigrationReport | null, locale: Locale): PluginMigrationReport | null {
  return report ? {...report,failed:pluginReferencesPresentation(report.failed,locale)} : null;
}
