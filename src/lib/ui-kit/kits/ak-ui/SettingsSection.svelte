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
        <div class="settings-copy">
          <h3>{#if item.icon}<Icon name={item.icon} size={16} aria-hidden="true" />{/if}{item.title}</h3>
          {#if item.description}<p>{item.description}</p>{/if}
          {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
        </div>
        <div class="settings-row-actions">
          {#each item.actions as action (action.id)}
            <Button variant={action.intent === 'install' ? 'default' : action.intent === 'remove' ? 'ghost' : 'outline'} size="sm"
              disabled={action.disabled} aria-label={action.ariaLabel ?? action.label} aria-keyshortcuts={action.keyShortcuts}
              onclick={() => onAction(item.id, action.id)}>{action.label}</Button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
  {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
</section>
<style>
  .settings-group { min-width: 0; }
  header { margin-bottom: 12px; }
  h2 { margin: 0; color: var(--aibo-text); font-size: 13px; font-weight: 600; }
  p { margin: 5px 0 0; color: var(--aibo-subtle); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .settings-rows { border: 1px solid var(--aibo-border); overflow: hidden; }
  .settings-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; min-height: 56px; padding: 8px 16px; }
  .settings-row + .settings-row { border-top: 1px solid var(--aibo-border); }
  .settings-copy { flex: 1 1 200px; min-width: 0; }
  h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 500; color: var(--aibo-text); overflow-wrap: anywhere; }
  .settings-row-actions { display: flex; flex-wrap: wrap; flex: 0 0 auto; gap: 8px; max-width: 100%; }
  kbd { display: inline-block; margin-top: 8px; padding: 2px 5px; border: 1px solid var(--aibo-border); border-radius: var(--ak-radius-subtle); color: var(--aibo-muted); font-size: 12px; line-height: 1.5; }
  .settings-error { color: var(--aibo-danger-text); }
</style>
