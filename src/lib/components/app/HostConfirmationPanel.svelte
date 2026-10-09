<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Select, Button } from '$lib/ui-kit';
  import { localizedHostConfirmationCategories, type HostConfirmationState, type HostConfirmationCategory, type HostConfirmationPolicy } from '$lib/app/host-confirmation-controller';
  const categories = $derived(localizedHostConfirmationCategories($locale));
  let { state, desktop, onChange, onReload }: {
    state: HostConfirmationState;
    desktop: boolean;
    onChange: (category: HostConfirmationCategory, policy: HostConfirmationPolicy) => void;
    onReload: () => void;
  } = $props();
</script>

<section class="settings-section" aria-labelledby="host-confirmation-title" aria-busy={state.loading || state.saving}>
  <div class="settings-section-heading"><div><h2 id="host-confirmation-title">{$t('confirmation.title')}</h2><p>{$t('confirmation.description')}</p><p>{$t('confirmation.permissions')}</p></div></div>
  {#each categories as category (category.id)}
    <label class="workspace-preference-option">
      <span><strong>{category.label}</strong><small id={`host-confirmation-${category.id}-description`}>{category.description}</small></span>
      <Select aria-label={$t('confirmation.policyLabel', { category: category.label })} aria-describedby={`host-confirmation-${category.id}-description`}
        value={state.value?.[category.id] ?? ''} disabled={!desktop || !state.value || state.loading || state.saving}
        placeholder={desktop ? $t('common.notLoaded') : $t('common.desktopAvailable')}
        options={[{value:'always-allow',label:$t('confirmation.allow')},{value:'ask',label:$t('confirmation.ask')}]}
        onSelect={policy => { if (policy === 'always-allow' || policy === 'ask') onChange(category.id, policy); }} />
    </label>
  {/each}
  {#if !desktop}<p class="workspace-preference-status">{$t('common.desktopSettings')}</p>
  {:else if state.loading || state.saving}<p class="workspace-preference-status" role="status">{state.saving ? $t('common.saving') : $t('common.loading')}</p>{/if}
  {#if state.error}<div class="workspace-preference-status"><p role="alert">{translateMessage($locale, state.error)}</p><Button variant="ghost" size="sm" onclick={onReload} disabled={state.loading || state.saving}>{$t('confirmation.reload')}</Button></div>{/if}
</section>
