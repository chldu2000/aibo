<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
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
