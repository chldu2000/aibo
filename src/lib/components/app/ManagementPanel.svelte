<script lang="ts">
  import { t, locale } from '$lib/i18n/runtime';
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { AgentSettingsForm, Button, Badge, Icon, ManagementDataView, SegmentedControl, Tabs } from '$lib/ui-kit';
  import type { ManagementPanelEntry } from '$lib/app/management-panels';
  import type { AgentSettingsState } from '$lib/app/agent-settings-controller';
  import type { AgentSettingsTarget, AgentSettingValue } from '../../../../packages/plugin-protocol/src/settings';
  import type { CapabilityScope } from '../../../../packages/plugin-protocol/src/capability';
  import type { ManagementDataState } from '$lib/app/management-data-controller';
  type Form = { key: string; target: AgentSettingsTarget; state?: AgentSettingsState };
  let { panel, sectionId, scope, forms, workspaceId, session, onSection, onScope, onChange, onSave, onReset, onReload, dataState, onRefresh }: {
    dataState?: ManagementDataState; onRefresh?(): void;
    panel: ManagementPanelEntry; sectionId: string; scope: CapabilityScope['kind']; forms: Form[];
    workspaceId: string | null; session: { id: string; agent: string; pluginInstallationId: string | null; archived: boolean } | null;
    onSection(id: string): void; onScope(scope: CapabilityScope['kind']): void;
    onChange(target: AgentSettingsTarget, key: string, value: AgentSettingValue | undefined): void;
    onSave(target: AgentSettingsTarget): void; onReset(target: AgentSettingsTarget): void; onReload(target: AgentSettingsTarget): void;
  } = $props();
  const id = $props.id();
  const sections = $derived(panel.declaration.sections);
  const section = $derived(sections.find(item => item.id === sectionId) ?? sections[0]);
  const currentData = $derived(dataState?.target?.installationId === panel.installationId && dataState.target.panelId === panel.declaration.id && dataState.target.sectionId === section.id ? dataState : undefined);
  const readsData = $derived(Boolean(section.providers?.application) && scope === 'application');
  const scopeLabel = (kind: CapabilityScope['kind']) => kind === 'application' ? $t('app.globalScope') : kind === 'workspace' ? $t('app.currentProject') : $t('app.currentSession');
  const scopeDisabled = (kind: CapabilityScope['kind']) => (kind === 'workspace' && !workspaceId)
    || (kind === 'session' && (!session || session.archived || session.pluginInstallationId !== panel.installationId
      || !(section.settingsReferences ?? []).some(ref => ref.contributionId === session?.agent && ref.scopes.includes('session'))));
</script>

<section class="settings-section" aria-labelledby="{id}-title" aria-busy={currentData?.loading ?? false}>
  <div class="settings-section-heading">
    <div><h2 id="{id}-title">{panel.declaration.title}</h2></div>
    <div class="settings-row-actions">
      {#if !panel.enabled}<Badge variant="outline">{$t('app.disabled')}</Badge>{/if}
      {#if readsData}
        <Button variant="ghost" size="icon" title={$t('management.refresh')} aria-label={$t('management.refresh')} onclick={onRefresh}
          disabled={!panel.enabled || currentData?.loading}><Icon name="refresh" size={16} /></Button>
      {/if}
    </div>
  </div>
  {#if sections.length > 1}
    <Tabs label={$t('management.sections')} idPrefix={id} items={sections.map(item => ({ id: item.id, label: item.title }))} value={section.id} onSelect={onSection} />
  {/if}
  <div id="{id}-panel" class="settings-tab-panel" role={sections.length > 1 ? 'tabpanel' : undefined} aria-labelledby={sections.length > 1 ? `${id}-tab-${section.id}` : undefined}>
    {#if section.scopes.length > 1}
      <SegmentedControl label={$t('management.scope')} name="{id}-scope" value={scope}
        options={section.scopes.map(kind => ({ value: kind, label: scopeLabel(kind), disabled: scopeDisabled(kind) }))}
        onSelect={value => onScope(value as CapabilityScope['kind'])} />
    {/if}
    {#each forms as form (form.key)}
      {@const state = form.state}
      {#if state?.snapshot}
        <AgentSettingsForm snapshot={state.snapshot} draft={state.draft} busy={state.loading || state.saving}
          error={state.error ? translateMessage($locale, state.error) : null} notice={state.notice ? translateMessage($locale, state.notice) : null}
          onChange={(key, value) => onChange(form.target, key, value)} onSave={() => onSave(form.target)} onReset={() => onReset(form.target)} onReload={() => onReload(form.target)} />
      {:else if state?.error}
        <div class="settings-section-body">
          <p role="alert">{translateMessage($locale, state.error)}</p>
          <div class="settings-row-actions"><Button variant="outline" size="sm" onclick={() => onReload(form.target)}>{$t('app.retry')}</Button></div>
        </div>
      {:else}<p role="status">{$t('app.loadingAgentSettings')}</p>{/if}
    {/each}
    {#if readsData}
      <ManagementDataView ownerTitle={panel.declaration.title} data={currentData?.data ?? null}
        status={!panel.enabled ? 'disabled' : currentData?.failed ? 'failed' : currentData?.data && !currentData.loading ? 'ready' : 'loading'} />
    {/if}
    {#if !forms.length && !readsData}<p role="status">{$t('management.noScope')}</p>{/if}
  </div>
</section>
