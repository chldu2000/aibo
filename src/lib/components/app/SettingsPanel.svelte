<script lang="ts">
  import type { LanguagePreference } from '../../../../packages/i18n/index.js';
  import { t } from '$lib/i18n/runtime';
  import { tick, untrack, type Snippet } from 'svelte';
  import { Button, Icon, ManagementCenter, Separator, themeForColorScheme, themePaletteOptions } from '$lib/ui-kit';
  import type { UiKitOption, UiManagementSection } from '$lib/ui-kit';

  type SettingsPanelProps = {
    languagePreference: LanguagePreference;
    onSelectLanguage: (value: LanguagePreference) => void;
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

  let { languagePreference, onSelectLanguage, layoutSettings, appearanceActions, appearanceError, appearanceBusy = false, workspaceSettings, packageManagement, extensions, runtime, open, activeSection, uiKits, activeUiKitName, activeThemeId, onSelectUiKit, onSelectTheme, onSelectSection, onClose }: SettingsPanelProps = $props();
  let openedKit = $state<string | null>(null);
  let requestedKit = $state<string | null>(null);
  $effect.pre(() => { if (open) { openedKit = untrack(() => activeUiKitName); requestedKit = null; } });
  const activeKit = $derived(uiKits.find((kit) => kit.id === activeUiKitName) ?? uiKits[0]);
  const selectedTheme = $derived(activeKit?.themes.find(theme => theme.id === activeThemeId));
  const palettes = $derived(themePaletteOptions(activeKit?.themes ?? [], activeThemeId));
  const modes = $derived([{ id: 'light', label: $t('appearance.light') }, { id: 'dark', label: $t('appearance.dark') }] as const);
</script>

{#snippet appearanceContent()}
  <div class="settings-tab-panel">
    <section class="settings-section" aria-labelledby="language-title">
      <div class="settings-section-heading"><div><h2 id="language-title">{$t('language.title')}</h2><p>{$t('language.description')}</p></div></div>
      <div class="appearance-mode-control" role="radiogroup" aria-label={$t('language.title')}>
        {#each ['system', 'zh-CN', 'en'] as value}
          <label class="appearance-mode-option" class:active={languagePreference === value}>
            <input type="radio" name="interface-language" {value} checked={languagePreference === value}
              onchange={() => onSelectLanguage(value as LanguagePreference)} />
            <span class="appearance-choice-mark" aria-hidden="true">{#if languagePreference === value}<Icon name="check" size={16} />{/if}</span>
            <span>{value === 'system' ? $t('language.system') : value === 'zh-CN' ? $t('language.zh-CN') : $t('language.en')}</span>
          </label>
        {/each}
      </div>
    </section>
    <Separator />
    <section class="settings-section" aria-labelledby="theme-color-title">
      {#if palettes.length}
      <div class="settings-section-heading"><div><h2 id="theme-color-title">{$t('appearance.mode')}</h2><p>{$t('appearance.mode.description')}</p></div></div>
      <div class="appearance-mode-control" role="radiogroup" aria-label={$t('appearance.mode')}>
        {#each modes as mode (mode.id)}
          {@const theme = themeForColorScheme(activeKit.themes, activeThemeId, mode.id)}
          <label class="appearance-mode-option" class:active={selectedTheme?.colorScheme === mode.id} class:unavailable={!theme}>
            <input type="radio" name="appearance-mode" value={mode.id} aria-label={mode.label} disabled={appearanceBusy || !theme}
              checked={selectedTheme?.colorScheme === mode.id} onchange={() => { if (theme) onSelectTheme(theme.id); }} />
            <span class="appearance-choice-mark" aria-hidden="true">{#if selectedTheme?.colorScheme === mode.id}<Icon name="check" size={16} />{/if}</span>
            <span>{mode.label}</span>
          </label>
        {/each}
      </div>
      <div class="settings-section-heading appearance-palette-heading"><div><h2 id="palette-title">{$t('appearance.palette')}</h2><p>{$t('appearance.palette.description')}</p></div></div>
      <div class="appearance-palette-grid" role="radiogroup" aria-labelledby="palette-title">
        {#each palettes as palette (palette.id)}
          <label class="appearance-palette-option" class:active={selectedTheme?.palette?.id === palette.id} class:unavailable={!palette.themeId}>
            <input type="radio" name="appearance-palette" value={palette.id} aria-label={palette.label} disabled={appearanceBusy || !palette.themeId}
              checked={selectedTheme?.palette?.id === palette.id} onchange={() => { if (palette.themeId) onSelectTheme(palette.themeId); }} />
            <span class="appearance-palette-preview" aria-hidden="true">{#each palette.swatches as swatch}<i style:background={swatch}></i>{/each}</span>
            <span class="appearance-palette-name"><strong>{palette.label}</strong><span class="appearance-choice-mark" aria-hidden="true">{#if selectedTheme?.palette?.id === palette.id}<Icon name="check" size={16} />{/if}</span></span>
            <small>{palette.themeId ? palette.description : $t('appearance.modeUnavailable')}</small>
          </label>
        {/each}
      </div>
      {:else}
      <div class="settings-section-heading"><div><h2 id="theme-color-title">{$t('appearance.theme')}</h2><p>{$t('appearance.theme.description')}</p></div></div>
      <div class="appearance-theme-grid" role="radiogroup" aria-label={$t('appearance.theme')}>
        {#each activeKit?.themes ?? [] as theme (theme.id)}
          <label class:active={theme.id === activeThemeId} class="appearance-theme-option" >
            <input type="radio" name="appearance-theme" value={theme.id} disabled={appearanceBusy} checked={theme.id === activeThemeId} onchange={() => onSelectTheme(theme.id)} />
            <span class="theme-swatches" aria-hidden="true">{#each theme.swatches as swatch}<i style:background={swatch}></i>{/each}</span>
            <span class="theme-option-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span>
            {#if theme.id === activeThemeId}<Icon name="check" size={15} />{/if}
          </label>
        {/each}
      </div>
      {#if !activeKit?.themes.length}<p>{$t('appearance.noThemes')}</p>{/if}
      {/if}
    </section>
    <Separator />
    <section class="settings-section" aria-labelledby="ui-kit-title">
      <div class="settings-section-heading"><div><h2 id="ui-kit-title">{$t('appearance.skin')}</h2><p>{$t('appearance.skin.description')}</p></div></div>
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
    }}>{$t('appearance.manageSkins')}</Button></div>
    {#if appearanceError}<p role="alert">{appearanceError}</p>{/if}
  </div>
{/snippet}

{#snippet layoutContent()}<div class="settings-tab-panel">{@render layoutSettings?.()}</div>{/snippet}
{#snippet workspaceContent()}<div class="settings-tab-panel">{@render workspaceSettings?.()}</div>{/snippet}
{#snippet extensionContent()}<div class="settings-tab-panel">{@render extensions?.()}{@render packageManagement?.()}</div>{/snippet}
{#snippet runtimeContent()}<div class="settings-tab-panel">{@render runtime?.()}</div>{/snippet}

{#if open}
  <ManagementCenter title={$t('settings.title')} restoreTriggerFocus={openedKit === activeUiKitName && (requestedKit === null || requestedKit === openedKit)} {activeSection} {onSelectSection} {onClose} appearance={appearanceContent} layout={layoutContent} workspace={workspaceContent} extensions={extensionContent} runtime={runtimeContent} />
{/if}
