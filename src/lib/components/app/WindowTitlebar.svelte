<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';

  type WindowTitlebarProps = {
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    onOpenPlugins: () => void;
    onOpenHistory: () => void;
    sidePanelOpen: boolean;
    onToggleSidePanel: () => void;
    onToggleMaximize: () => void;
    onMinimize: () => void;
    onClose: () => void;
  };

  let {
    onOpenSettings,
    onOpenDiagnostics,
    onOpenPlugins,
    onOpenHistory,
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
  aria-label="窗口标题栏"
  tabindex="-1"
>
  <span class="window-title">Aibo</span>
  <div class="window-actions">
    <Button variant="ghost" type="button" data-host-navigation="plugins" onclick={onOpenPlugins}>插件</Button>
    <Button variant="ghost" type="button" data-host-navigation="history" onclick={onOpenHistory}>执行历史</Button>
    <Button variant="ghost" size="icon" type="button" aria-label="打开设置" title="设置" onclick={onOpenSettings}>
      <Icon name="settings" size={15} />
    </Button>
    <Button variant="ghost" size="icon" type="button" aria-label="打开 Agent 诊断" title="Agent 诊断" onclick={onOpenDiagnostics}>
      <Icon name="diagnostics" size={15} />
    </Button>
    <Button
      variant={sidePanelOpen ? 'secondary' : 'ghost'}
      size="icon"
      type="button"
      aria-label={sidePanelOpen ? '隐藏侧边栏' : '显示侧边栏'}
      title="侧边栏"
      aria-pressed={sidePanelOpen}
      onclick={onToggleSidePanel}
    >
      <Icon name="panel-right" size={15} />
    </Button>
    {#if !isMacOS}
      <div class="window-system-actions" aria-label="窗口控制">
        <Button variant="ghost" size="icon" type="button" aria-label="最小化窗口" title="最小化" onclick={onMinimize}>
          <Icon name="window-minimize" size={14} />
        </Button>
        <Button variant="ghost" size="icon" type="button" aria-label="最大化或还原窗口" title="最大化或还原" onclick={onToggleMaximize}>
          <Icon name="window-maximize" size={14} />
        </Button>
        <Button variant="ghost" size="icon" type="button" data-window-action="close" aria-label="关闭窗口" title="关闭" onclick={onClose}>
          <Icon name="close" size={14} />
        </Button>
      </div>
    {/if}
  </div>
</header>
