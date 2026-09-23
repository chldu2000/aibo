<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { Icon, ManagementCenter, Separator } from '$lib/ui-kit';
  import type { UiKitOption, UiManagementSection } from '$lib/ui-kit';

  type SettingsPanelProps = {
    presentationActions?: Snippet;
    workspaceSettings?: Snippet;
    packageManagement?: Snippet;
    extensions?: Snippet;
    runtime?: Snippet;
    open: boolean;
    activeSection: UiManagementSection;
    uiKits: readonly UiKitOption[];
    activeUiKitName: string;
    activeThemeId: string;
    onSelectUiKit: (kitId: string) => void;
    onSelectTheme: (themeId: string) => void;
    onSelectSection: (section: UiManagementSection) => void;
    onClose: () => void;
  };

  let { presentationActions, workspaceSettings, packageManagement, extensions, runtime, open, activeSection, uiKits, activeUiKitName, activeThemeId, onSelectUiKit, onSelectTheme, onSelectSection, onClose }: SettingsPanelProps = $props();
  let openedKit = $state<string | null>(null);
  let requestedKit = $state<string | null>(null);
  $effect.pre(() => { if (open) { openedKit = untrack(() => activeUiKitName); requestedKit = null; } });
  const activeKit = $derived(uiKits.find((kit) => kit.id === activeUiKitName) ?? uiKits[0]);
</script>

{#snippet appearanceContent()}
  <div class="settings-tab-panel">
    {#if workspaceSettings}{@render workspaceSettings()}<Separator />{/if}
    {@render presentationActions?.()}
    {@render packageManagement?.()}
    <section class="settings-section" aria-labelledby="ui-kit-title">
      <div class="settings-section-heading"><div><h2 id="ui-kit-title">界面皮肤</h2><p>切换会立即应用，并在下次启动时恢复。</p></div></div>
      {#if uiKits.length === 1}
        <div class="appearance-kit-info"><strong>{uiKits[0].label}</strong><span>{uiKits[0].description}</span></div>
      {:else}
      <div class="appearance-kit-grid">
        {#each uiKits as kit (kit.id)}
          <button class:active={kit.id === activeUiKitName} class="appearance-kit-option" type="button" aria-pressed={kit.id === activeUiKitName} onclick={() => { requestedKit = kit.id; onSelectUiKit(kit.id); }}>
            <span class="appearance-option-heading"><strong>{kit.label}</strong>{#if kit.id === activeUiKitName}<Icon name="check" size={15} />{/if}</span>
            <small>{kit.description}</small>
          </button>
        {/each}
      </div>
      {/if}
    </section>
    <Separator />
    <section class="settings-section" aria-labelledby="theme-color-title">
      <div class="settings-section-heading"><div><h2 id="theme-color-title">主题色</h2><p>颜色方案由当前皮肤提供。</p></div></div>
      <div class="appearance-theme-grid" role="radiogroup" aria-label="主题色">
        {#each activeKit?.themes ?? [] as theme (theme.id)}
          <label class:active={theme.id === activeThemeId} class="appearance-theme-option" >
            <input type="radio" name="appearance-theme" value={theme.id} checked={theme.id === activeThemeId} onchange={() => onSelectTheme(theme.id)} />
            <span class="theme-swatches" aria-hidden="true">{#each theme.swatches as swatch}<i style:background={swatch}></i>{/each}</span>
            <span class="theme-option-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span>
            {#if theme.id === activeThemeId}<Icon name="check" size={15} />{/if}
          </label>
        {/each}
      </div>
    </section>
  </div>
{/snippet}

{#snippet extensionContent()}<div class="settings-tab-panel">{@render extensions?.()}</div>{/snippet}
{#snippet runtimeContent()}<div class="settings-tab-panel">{@render runtime?.()}</div>{/snippet}

{#if open}
  <ManagementCenter title="管理中心" restoreTriggerFocus={openedKit === activeUiKitName && (requestedKit === null || requestedKit === openedKit)} {activeSection} {onSelectSection} {onClose} appearance={appearanceContent} extensions={extensionContent} runtime={runtimeContent} />
{/if}
