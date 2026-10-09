<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Button } from '$lib/ui-kit';
  import type { WorkspacePreferencesState } from '$lib/app/workspace-preferences-controller';
  let { state, desktop, onChange, onReload }: {
    state: WorkspacePreferencesState;
    desktop: boolean;
    onChange: (trusted: boolean) => void;
    onReload: () => void;
  } = $props();
</script>

<section class="settings-section" aria-labelledby="workspace-preferences-title" aria-busy={state.loading || state.saving}>
  <div class="settings-section-heading"><div><h2 id="workspace-preferences-title">{$t('settings.workspace')}</h2><p>{$t('workspace.preferencesDescription')}</p></div></div>
  <label class="workspace-preference-option">
    <span><strong>{$t('workspace.trustNew')}</strong><small id="workspace-trust-default-description">{$t('workspace.trustNewDescription')}</small></span>
    <input type="checkbox" role="switch" aria-label={$t('workspace.trustNew')} aria-describedby="workspace-trust-default-description"
      checked={state.value?.trustNewWorkspaces ?? false}
      disabled={!desktop || !state.value || state.loading || state.saving}
      onchange={event => {
        const trusted = event.currentTarget.checked;
        event.currentTarget.checked = state.value?.trustNewWorkspaces ?? false;
        onChange(trusted);
      }} />
  </label>
  {#if !desktop}<p class="workspace-preference-status">{$t('common.desktopSettings')}</p>
  {:else if state.loading || state.saving}<p class="workspace-preference-status" role="status">{state.saving ? $t('common.saving') : $t('common.loading')}</p>{/if}
  {#if state.error}<div class="workspace-preference-status"><p role="alert">{translateMessage($locale, state.error)}</p><Button variant="ghost" size="sm" onclick={onReload} disabled={state.loading || state.saving}>{$t('workspace.reloadPreferences')}</Button></div>{/if}
</section>
