<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { Button, Icon, ManagementCenter, Separator } from '$lib/ui-kit';
  import type { UiKitOption, UiManagementSection } from '$lib/ui-kit';

  type SettingsPanelProps = {
    layoutSettings?: Snippet;
    appearanceActions?: Snippet;
    appearanceError?: string;
    appearanceBusy?: boolean;
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

  let { layoutSettings, appearanceActions, appearanceError, appearanceBusy = false, workspaceSettings, packageManagement, extensions, runtime, open, activeSection, uiKits, activeUiKitName, activeThemeId, onSelectUiKit, onSelectTheme, onSelectSection, onClose }: SettingsPanelProps = $props();
  let openedKit = $state<string | null>(null);
  let requestedKit = $state<string | null>(null);
  $effect.pre(() => { if (open) { openedKit = untrack(() => activeUiKitName); requestedKit = null; } });
  const activeKit = $derived(uiKits.find((kit) => kit.id === activeUiKitName) ?? uiKits[0]);
</script>

{#snippet appearanceContent()}
  <div class="settings-tab-panel">
    <section class="settings-section" aria-labelledby="theme-color-title">
      <div class="settings-section-heading"><div><h2 id="theme-color-title">主题</h2><p>立即生效，下次启动时保留。颜色方案由当前皮肤提供。</p></div></div>
      <div class="appearance-theme-grid" role="radiogroup" aria-label="主题">
        {#each activeKit?.themes ?? [] as theme (theme.id)}
          <label class:active={theme.id === activeThemeId} class="appearance-theme-option" >
            <input type="radio" name="appearance-theme" value={theme.id} disabled={appearanceBusy} checked={theme.id === activeThemeId} onchange={() => onSelectTheme(theme.id)} />
            <span class="theme-swatches" aria-hidden="true">{#each theme.swatches as swatch}<i style:background={swatch}></i>{/each}</span>
            <span class="theme-option-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span>
            {#if theme.id === activeThemeId}<Icon name="check" size={15} />{/if}
          </label>
        {/each}
      </div>
      {#if !activeKit?.themes.length}<p>此皮肤未提供可切换主题。</p>{/if}
    </section>
    <Separator />
    <section class="settings-section" aria-labelledby="ui-kit-title">
      <div class="settings-section-heading"><div><h2 id="ui-kit-title">界面皮肤</h2><p>切换会立即应用，并在下次启动时恢复。</p></div></div>
      {#if uiKits.length === 1}
        <div class="appearance-kit-info"><strong>{uiKits[0].label}</strong><span>{uiKits[0].description}</span></div>
      {:else}
      <div class="appearance-kit-grid">
        {#each uiKits as kit (kit.id)}
          <button class:active={kit.id === activeUiKitName} class="appearance-kit-option" type="button" disabled={appearanceBusy} aria-pressed={kit.id === activeUiKitName} onclick={() => { requestedKit = kit.id; onSelectUiKit(kit.id); }}>
            <span class="appearance-option-heading"><strong>{kit.label}</strong>{#if kit.id === activeUiKitName}<Icon name="check" size={15} />{/if}</span>
            <small>{kit.description}</small>
          </button>
        {/each}
      </div>
      {/if}
    </section>
    {@render appearanceActions?.()}
    <div class="settings-actions"><Button variant="outline" onclick={async () => {
      onSelectSection('extensions');
      await tick();
      document.getElementById('presentation-packages')?.focus();
    }}>管理皮肤插件…</Button></div>
    {#if appearanceError}<p role="alert">{appearanceError}</p>{/if}
  </div>
{/snippet}

{#snippet layoutContent()}<div class="settings-tab-panel">{@render layoutSettings?.()}</div>{/snippet}
{#snippet workspaceContent()}<div class="settings-tab-panel">{@render workspaceSettings?.()}</div>{/snippet}
{#snippet extensionContent()}<div class="settings-tab-panel">{@render extensions?.()}{@render packageManagement?.()}</div>{/snippet}
{#snippet runtimeContent()}<div class="settings-tab-panel">{@render runtime?.()}</div>{/snippet}

{#if open}
  <ManagementCenter title="工作台设置" restoreTriggerFocus={openedKit === activeUiKitName && (requestedKit === null || requestedKit === openedKit)} {activeSection} {onSelectSection} {onClose} appearance={appearanceContent} layout={layoutContent} workspace={workspaceContent} extensions={extensionContent} runtime={runtimeContent} />
{/if}
