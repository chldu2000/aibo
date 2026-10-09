<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { Button, Icon } from '$lib/ui-kit';

  type WindowTitlebarProps = {
    onOpenManagement: () => void;
    onOpenSearch?: () => void;
    onToggleTheme?: () => void;
    themeLabel?: string;
    colorScheme?: 'light' | 'dark';
    managementNeedsAttention: boolean;
    sidePanelOpen: boolean;
    onToggleSidePanel: () => void;
    onToggleMaximize: () => void;
    onMinimize: () => void;
    onClose: () => void;
  };

  let {
    onOpenManagement,
    onOpenSearch,
    onToggleTheme,
    themeLabel,
    colorScheme = 'light',
    managementNeedsAttention,
    sidePanelOpen,
    onToggleSidePanel,
    onToggleMaximize,
    onMinimize,
    onClose,
  }: WindowTitlebarProps = $props();
  const isMacOS = navigator.platform.startsWith('Mac');

</script>

<header
  class="window-titlebar"
  class:macos-titlebar={isMacOS}
  data-ui-component="window-titlebar"
  data-tauri-drag-region="deep"
  role="toolbar"
  aria-label={$t('window.titlebar')}
  tabindex="-1"
>
  <span class="window-title">Aibo</span>
  <div class="window-actions">
    {#if onOpenSearch}<Button variant="ghost" size="icon" data-host-navigation="search" aria-label={$t('window.search')} title={$t('window.searchHint')} onclick={onOpenSearch}><Icon name="search" size={15} /></Button>{/if}
    {#if onToggleTheme}<Button variant="ghost" size="icon" aria-label={$t('window.toggleTheme')} title={themeLabel} onclick={onToggleTheme}><Icon name={colorScheme === 'dark' ? 'sun' : 'moon'} size={15} /></Button>{/if}
    <Button variant={managementNeedsAttention ? 'secondary' : 'ghost'} size="icon" type="button" data-host-navigation="management" aria-label={managementNeedsAttention ? $t('window.openSettingsAttention') : $t('window.openSettings')} title={managementNeedsAttention ? $t('window.settingsAttention') : $t('window.settingsHint')} onclick={onOpenManagement}>
      <Icon name="settings" size={15} />
    </Button>
    <Button
      variant={sidePanelOpen ? 'secondary' : 'ghost'}
      size="icon"
      type="button"
      aria-label={sidePanelOpen ? $t('window.hideSidebar') : $t('window.showSidebar')}
      title={$t('window.sidebar')}
      aria-pressed={sidePanelOpen}
      onclick={onToggleSidePanel}
    >
      <Icon name="panel-right" size={15} />
    </Button>
    {#if !isMacOS}
      <div class="window-system-actions" aria-label={$t('window.controls')}>
        <Button variant="ghost" size="icon" type="button" aria-label={$t('window.minimize')} title={$t('window.minimizeHint')} onclick={onMinimize}>
          <Icon name="window-minimize" size={14} />
        </Button>
        <Button variant="ghost" size="icon" type="button" aria-label={$t('window.maximize')} title={$t('window.maximizeHint')} onclick={onToggleMaximize}>
          <Icon name="window-maximize" size={14} />
        </Button>
        <Button variant="ghost" size="icon" type="button" data-window-action="close" aria-label={$t('window.close')} title={$t('common.close')} onclick={onClose}>
          <Icon name="close" size={14} />
        </Button>
      </div>
    {/if}
  </div>
</header>
