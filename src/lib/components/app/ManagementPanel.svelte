<script lang="ts">
  import { t, locale } from '$lib/i18n/runtime';
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { AgentSettingsForm, Button, Badge } from '$lib/ui-kit';
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
  const section = $derived(panel.declaration.sections.find(item => item.id === sectionId) ?? panel.declaration.sections[0]);
  const currentData = $derived(dataState?.target?.installationId === panel.installationId && dataState.target.panelId === panel.declaration.id && dataState.target.sectionId === section.id ? dataState : undefined);
</script>

<section class="settings-section" aria-label={panel.declaration.title}>
  <div class="settings-section-heading">
    <h2>{panel.declaration.title}</h2>
    {#if !panel.enabled}<Badge>{$t('app.disabled')}</Badge>{/if}
  </div>
  <div class="settings-row-actions" role="group" aria-label={$t('management.sections')}>
    {#each panel.declaration.sections as item (item.id)}
      <Button variant={section.id === item.id ? 'secondary' : 'ghost'} aria-pressed={section.id === item.id} onclick={() => onSection(item.id)}>{item.title}</Button>
    {/each}
  </div>
  <div class="settings-row-actions" role="group" aria-label={$t('management.scope')}>
    {#each section.scopes as kind}
      <Button variant={scope === kind ? 'secondary' : 'outline'} aria-pressed={scope === kind}
        disabled={(kind === 'workspace' && !workspaceId) || (kind === 'session' && (!session || session.archived || session.pluginInstallationId !== panel.installationId || !(section.settingsReferences ?? []).some(ref => ref.contributionId === session?.agent && ref.scopes.includes('session'))))}
        onclick={() => onScope(kind)}>{kind === 'application' ? $t('app.globalScope') : kind === 'workspace' ? $t('app.currentProject') : $t('app.currentSession')}</Button>
    {/each}
  </div>
  <div class="settings-section-body">
    {#each forms as form (form.key)}
      {@const state = form.state}
      {#if state?.snapshot}
        <AgentSettingsForm snapshot={state.snapshot} draft={state.draft} busy={state.loading || state.saving}
          error={state.error ? translateMessage($locale, state.error) : null} notice={state.notice ? translateMessage($locale, state.notice) : null}
          onChange={(key, value) => onChange(form.target, key, value)} onSave={() => onSave(form.target)} onReset={() => onReset(form.target)} onReload={() => onReload(form.target)} />
      {:else if state?.error}
        <p role="alert">{translateMessage($locale, state.error)}</p>
        <div class="settings-row-actions"><Button onclick={() => onReload(form.target)}>{$t('app.retry')}</Button></div>
      {:else}<p role="status">{$t('app.loadingAgentSettings')}</p>{/if}
    {/each}
    {#if section.providers?.application && scope === 'application'}
      <div class="settings-row-actions"><Button onclick={onRefresh} disabled={!panel.enabled || currentData?.loading}>{$t('management.refresh')}</Button></div>
      {#if !panel.enabled}<p role="status">{$t('management.enableToRead')}</p>
      {:else if currentData?.loading}<p role="status">{$t('management.loading')}</p>
      {:else if currentData?.failed}<p role="alert">{$t('management.readUnavailable')}</p>
      {:else if currentData?.data}
        {@const data = currentData.data}
        <p>{data.target.label}</p>
        {#if data.message}<p role="status">{data.message}</p>{/if}
        {#each data.properties as property (property.key)}
          <div class="settings-row"><span>{property.label}</span><span>{property.value}</span></div>
        {/each}
        {#each data.metrics as metric (metric.key)}
          <div class="settings-row"><span>{metric.label}</span><span>{metric.value}{metric.unit}</span></div>
          {#if metric.resetsAt}<p>{new Date(metric.resetsAt * 1000).toLocaleString($locale)}</p>{/if}
        {/each}
        <p>{$t('management.observedAt', {time:data.observedAt})}</p>
      {/if}
    {/if}
    {#if !forms.length && !(section.providers?.application && scope === 'application')}<p role="status">{$t('management.noScope')}</p>{/if}
  </div>
</section>
