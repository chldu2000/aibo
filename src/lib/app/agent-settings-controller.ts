import type { AgentSettingsTarget, AgentSettingsSnapshot, AgentSettingsSave, AgentSettingValue } from '../../../packages/plugin-protocol/src/settings';
export type AgentSettingsState = {
  target: AgentSettingsTarget | null; snapshot: AgentSettingsSnapshot | null;
  draft: Record<string, AgentSettingValue>; loading: boolean; saving: boolean; error: string | null; notice: string | null;
};
export function createAgentSettingsController(ports: {
  read(target: AgentSettingsTarget): Promise<AgentSettingsSnapshot>;
  save(request: AgentSettingsSave): Promise<AgentSettingsSnapshot>;
  changed(state: AgentSettingsState): void;
}) {
  const empty = (): AgentSettingsState => ({target:null,snapshot:null,draft:{},loading:false,saving:false,error:null,notice:null});
  const entries = new Map<string, AgentSettingsState>();
  let current = empty();
  const publish = () => ports.changed({...current, draft:{...current.draft}});
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^(?:settings_conflict|settings_unavailable|invalid_settings):\s*/, '');
  async function load(entry: AgentSettingsState, preserveDraft = false) {
    if (!entry.target || entry.loading || entry.saving) return;
    entry.loading = true;
    if (!preserveDraft) { entry.error = null; entry.notice = null; }
    publish();
    try {
      const next = await ports.read(entry.target);
      if (preserveDraft && entry.snapshot) {
        if (next.descriptor.version !== entry.snapshot.descriptor.version) entry.error = '设置版本已改变，请重新加载。';
        else entry.snapshot = {...entry.snapshot,inheritedValues:next.inheritedValues};
      } else { entry.snapshot = next; entry.draft = {...next.values}; }
    }
    catch (error) { entry.error = errorMessage(error); }
    finally { entry.loading = false; publish(); }
  }
  return {
    async select(target: AgentSettingsTarget | null) {
      if (!target) { current = empty(); publish(); return; }
      const key = JSON.stringify([target.installationId,target.contributionId,target.scope.kind,'id' in target.scope ? target.scope.id : '']);
      let entry = entries.get(key);
      if (!entry) { entry = {...empty(),target}; entries.set(key,entry); }
      current = entry; publish();
      const dirty = Boolean(entry.snapshot && JSON.stringify(entry.draft) !== JSON.stringify(entry.snapshot.values));
      await load(entry, dirty);
    },
    change(key: string, value: AgentSettingValue | undefined) {
      if (!current.snapshot || current.loading || current.saving || !current.snapshot.descriptor.fields.some(field => field.key === key)) return;
      current.draft = {...current.draft};
      if (value === undefined) delete current.draft[key]; else current.draft[key] = value;
      current.error = null; current.notice = null; publish();
    },
    reset() { if (!current.loading && !current.saving) { current.draft = {}; current.notice = null; publish(); } },
    reload() { return load(current); },
    async save() {
      const entry = current;
      if (!entry.target || !entry.snapshot || entry.loading || entry.saving) return;
      entry.saving = true; entry.error = null; entry.notice = null; publish();
      try {
        entry.snapshot = await ports.save({...entry.target,version:entry.snapshot.descriptor.version,expectedRevision:entry.snapshot.revision,values:{...entry.draft}});
        entry.draft = {...entry.snapshot.values}; entry.notice = '已保存，将在下一次调用时提供给 Agent。';
      } catch (error) { entry.error = errorMessage(error); }
      finally { entry.saving = false; publish(); }
    },
  };
}
