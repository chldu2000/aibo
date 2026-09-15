<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button, Card, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { UiKitOption } from '$lib/ui-kit';

  type SettingsPanelProps = {
    presentationActions?: Snippet;
    packageManagement?: Snippet;
    extensions?: Snippet;
    runtime?: Snippet;
    open: boolean;
    activeSection: 'appearance' | 'extensions' | 'runtime';
    uiKits: readonly UiKitOption[];
    activeUiKitName: string;
    activeThemeId: string;
    onSelectUiKit: (kitId: string) => void;
    onSelectTheme: (themeId: string) => void;
    onSelectSection: (section: 'appearance' | 'extensions' | 'runtime') => void;
    onClose: () => void;
  };

  let {
    presentationActions,
    packageManagement,
    extensions,
    runtime,
    open,
    activeSection,
    uiKits,
    activeUiKitName,
    activeThemeId,
    onSelectUiKit,
    onSelectTheme,
    onSelectSection,
    onClose,
  }: SettingsPanelProps = $props();

  const activeKit = $derived(uiKits.find((kit) => kit.id === activeUiKitName) ?? uiKits[0]);
</script>

{#if open}
  <div class="settings-overlay" role="presentation" onclick={onClose}>
    <Card class="settings-panel" data-ui-component="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="settings-header">
        <CardTitle id="settings-title">管理中心</CardTitle>
        <Button variant="ghost" size="icon" type="button" aria-label="关闭管理中心" title="关闭" onclick={onClose}>
          <Icon name="close" size={16} />
        </Button>
      </CardHeader>
      <Separator />

      <nav class="management-navigation" aria-label="管理中心栏目">
        <Button variant={activeSection === 'appearance' ? 'secondary' : 'ghost'} size="sm" aria-pressed={activeSection === 'appearance'} onclick={() => onSelectSection('appearance')}>外观</Button>
        <Button variant={activeSection === 'extensions' ? 'secondary' : 'ghost'} size="sm" aria-pressed={activeSection === 'extensions'} onclick={() => onSelectSection('extensions')}>扩展</Button>
        <Button variant={activeSection === 'runtime' ? 'secondary' : 'ghost'} size="sm" aria-pressed={activeSection === 'runtime'} onclick={() => onSelectSection('runtime')}>运行状态</Button>
      </nav>
      <Separator />

      <div class="settings-content">
        {#if activeSection === 'appearance'}
        <div id="appearance-settings" class="settings-tab-panel" role="tabpanel" aria-label="外观">
          {@render presentationActions?.()}
          {@render packageManagement?.()}
          <section class="settings-section" aria-labelledby="ui-kit-title">
            <div class="settings-section-heading">
              <div>
                <h2 id="ui-kit-title">界面皮肤</h2>
                <p>切换会立即应用，并在下次启动时恢复。</p>
              </div>
            </div>
            <div class="appearance-kit-grid">
              {#each uiKits as kit (kit.id)}
                <button
                  class:active={kit.id === activeUiKitName}
                  class="appearance-kit-option"
                  type="button"
                  aria-pressed={kit.id === activeUiKitName}
                  onclick={() => onSelectUiKit(kit.id)}
                >
                  <span class="appearance-option-heading">
                    <strong>{kit.label}</strong>
                    {#if kit.id === activeUiKitName}<Icon name="check" size={15} />{/if}
                  </span>
                  <small>{kit.description}</small>
                </button>
              {/each}
            </div>
          </section>

          <Separator />

          <section class="settings-section" aria-labelledby="theme-color-title">
            <div class="settings-section-heading">
              <div>
                <h2 id="theme-color-title">主题色</h2>
                <p>颜色方案由当前皮肤提供。</p>
              </div>
            </div>
            <div class="appearance-theme-grid">
              {#each activeKit?.themes ?? [] as theme (theme.id)}
                <button
                  class:active={theme.id === activeThemeId}
                  class="appearance-theme-option"
                  type="button"
                  aria-pressed={theme.id === activeThemeId}
                  onclick={() => onSelectTheme(theme.id)}
                >
                  <span class="theme-swatches" aria-hidden="true">
                    {#each theme.swatches as swatch}<i style:background={swatch}></i>{/each}
                  </span>
                  <span class="theme-option-copy">
                    <strong>{theme.label}</strong>
                    <small>{theme.description}</small>
                  </span>
                  {#if theme.id === activeThemeId}<Icon name="check" size={15} />{/if}
                </button>
              {/each}
            </div>
          </section>
        </div>
        {:else if activeSection === 'extensions'}
          <div id="extension-settings" class="settings-tab-panel" role="tabpanel" aria-label="扩展">{@render extensions?.()}</div>
        {:else}
          <div id="runtime-status" class="settings-tab-panel" role="tabpanel" aria-label="运行状态">{@render runtime?.()}</div>
        {/if}
      </div>

      <div class="settings-footer">
        <Button size="sm" type="button" onclick={onClose}>完成</Button>
      </div>
    </Card>
  </div>
{/if}

<style>
  .management-navigation { display: flex; gap: 0.5rem; padding: 0.75rem 1.25rem; overflow-x: auto; }
</style>
