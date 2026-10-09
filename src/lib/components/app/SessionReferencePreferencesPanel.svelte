<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Button, Input, Select } from '$lib/ui-kit';
  import type { SessionReferencePreferencesState } from '$lib/app/session-reference-preferences-controller';
  let { state: preferences, desktop, onChange, onReload }: {
    state: SessionReferencePreferencesState;
    desktop: boolean;
    onChange: (messageLimit: number | null) => void;
    onReload: () => void;
  } = $props();
  let recentCount = $state('12');
  const savedCount = $derived(preferences.value?.messageLimit);
  $effect(() => { if (savedCount != null) recentCount = String(savedCount); });
  const disabled = $derived(!desktop || !preferences.value || preferences.loading || preferences.saving);
  const validCount = $derived(Number.isInteger(Number(recentCount)) && Number(recentCount) >= 1 && Number(recentCount) <= 10000);
</script>

<section class="settings-section" aria-labelledby="session-reference-preferences-title" aria-busy={preferences.loading || preferences.saving}>
  <div class="settings-section-heading"><div><h2 id="session-reference-preferences-title">{$t('references.title')}</h2><p>{$t('references.description')}</p></div></div>
  <label class="workspace-preference-option">
    <span><strong>{$t('references.scope')}</strong><small>{$t('references.scopeDescription')}</small></span>
    <Select aria-label={$t('references.scopeLabel')} value={preferences.value ? (preferences.value.messageLimit === null ? 'all' : 'recent') : ''}
      {disabled} placeholder={$t('common.notLoaded')} options={[{ value: 'all', label: $t('references.all') }, { value: 'recent', label: $t('references.recent') }]}
      onSelect={mode => onChange(mode === 'all' ? null : (validCount ? Number(recentCount) : 12))} />
  </label>
  {#if preferences.value && preferences.value.messageLimit !== null}
    <div class="reference-count">
      <label for="session-reference-count">{$t('references.maximum')}</label>
      <div class="reference-count-controls">
      <Input id="session-reference-count" aria-label={$t('references.maximum')} type="number" min="1" max="10000" step="1" value={recentCount}
        {disabled} oninput={event => { recentCount = String(event.currentTarget.value); }} />
      <Button size="sm" disabled={disabled || !validCount || Number(recentCount) === preferences.value.messageLimit} onclick={() => onChange(Number(recentCount))}>{$t('references.saveCount')}</Button>
      </div>
    </div>
  {/if}
  <p class="workspace-preference-status">{$t('references.limit')}</p>
  {#if !desktop}<p class="workspace-preference-status">{$t('common.desktopSettings')}</p>
  {:else if preferences.loading || preferences.saving}<p class="workspace-preference-status" role="status">{preferences.saving ? $t('common.saving') : $t('common.loading')}</p>{/if}
  {#if preferences.error}<div class="workspace-preference-status"><p role="alert">{translateMessage($locale, preferences.error)}</p><Button variant="ghost" size="sm" onclick={() => { if (savedCount != null) recentCount = String(savedCount); onReload(); }} disabled={preferences.loading || preferences.saving}>{$t('references.reload')}</Button></div>{/if}
</section>

<style>
  .reference-count { display: grid; gap: 8px; }
  .reference-count-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; max-width: 320px; }
</style>
