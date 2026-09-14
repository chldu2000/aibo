<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Icon from './Icon.svelte';
  import type { UiSettingsSectionProps } from '../../contract';
  let { title, description, items, error, onAction }: UiSettingsSectionProps = $props();
  const id = $props.id();
</script>

<section class="settings-group" aria-labelledby={id} data-ui-component="settings-section">
  <header><h2 id={id}>{title}</h2>{#if description}<p>{description}</p>{/if}</header>
  <div class="settings-rows">
    {#each items as item (item.id)}
      <div class="settings-row" data-settings-item={item.id}>
        {#if item.icon}<span class="settings-leading" aria-hidden="true"><Icon name={item.icon} size={20} /></span>{/if}
        <div class="settings-row-content">
          <div class="settings-copy">
            <h3>{item.title}</h3>
            {#if item.description}<p>{item.description}</p>{/if}
            {#if item.shortcut}<small class="settings-shortcut">{item.shortcut}</small>{/if}
          </div>
          <div class="settings-row-actions">
            {#each item.actions as action (action.id)}
              <Button variant={action.intent === 'install' ? 'secondary' : 'ghost'} size="sm"
                disabled={action.disabled} aria-label={action.ariaLabel ?? action.label} aria-keyshortcuts={action.keyShortcuts}
                onclick={() => onAction(item.id, action.id)}>{action.label}</Button>
            {/each}
          </div>
        </div>
      </div>
    {/each}
  </div>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
</section>
<style>
  .settings-group { margin-inline: 20px; min-width: 0; }
  header { margin-bottom: 12px; padding-inline: 4px; }
  h2 { margin: 0; color: var(--m3c-primary); font-size: 13px; line-height: 1.5; font-weight: 500; }
  p { margin: 4px 0 0; color: var(--m3c-on-surface-variant); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .settings-rows { display: grid; gap: 2px; border-radius: 16px; overflow: hidden; }
  .settings-row { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--m3c-surface-container-high); }
  .settings-leading { display: flex; flex: none; color: var(--m3c-on-surface-variant); }
  .settings-row-content { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; flex: 1; min-width: 0; }
  .settings-copy { flex: 1 1 180px; min-width: 0; }
  h3 { margin: 0; color: var(--m3c-on-surface); font-size: 14px; line-height: 1.5; font-weight: 500; overflow-wrap: anywhere; }
  .settings-row-actions { display: flex; flex-wrap: wrap; flex: 0 0 auto; gap: 4px; max-width: 100%; }
  .settings-shortcut { display: block; margin-top: 6px; color: var(--m3c-on-surface-variant); font-size: 11px; line-height: 1.5; }
  .settings-error { color: var(--m3c-error); }
</style>
