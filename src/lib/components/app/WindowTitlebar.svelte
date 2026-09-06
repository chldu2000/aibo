<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';
  import type { SidePanelView } from './view-types';

  type WindowTitlebarProps = {
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    sidePanelView: SidePanelView | null;
    onToggleSidePanel: (view: SidePanelView) => void;
    onStartDragging: () => void;
  };

  let {
    onOpenSettings,
    onOpenDiagnostics,
    sidePanelView,
    onToggleSidePanel,
    onStartDragging,
  }: WindowTitlebarProps = $props();

  function handleTitlebarMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, input, textarea, select, a, [role="button"]')) return;
    onStartDragging();
  }
</script>

<header
  class="window-titlebar"
  data-ui-component="window-titlebar"
  role="toolbar"
  aria-label="窗口标题栏"
  tabindex="-1"
  onmousedown={handleTitlebarMouseDown}
>
  <span class="window-title">Aibo</span>
  <div class="window-actions">
    <Button variant="ghost" size="icon" type="button" aria-label="打开设置" title="设置" onclick={onOpenSettings}>
      <Icon name="settings" size={15} />
    </Button>
    <Button variant="ghost" size="icon" type="button" aria-label="打开 Agent 诊断" title="Agent 诊断" onclick={onOpenDiagnostics}>
      <Icon name="diagnostics" size={15} />
    </Button>
    <Button
      variant={sidePanelView === 'context' ? 'secondary' : 'ghost'}
      size="icon"
      type="button"
      aria-label={sidePanelView === 'context' ? '隐藏上下文面板' : '显示上下文面板'}
      title="上下文"
      aria-pressed={sidePanelView === 'context'}
      onclick={() => onToggleSidePanel('context')}
    >
      <Icon name="panel-right" size={15} />
    </Button>
    <Button
      variant={sidePanelView === 'git' ? 'secondary' : 'ghost'}
      size="icon"
      type="button"
      aria-label={sidePanelView === 'git' ? '隐藏 Git 面板' : '显示 Git 面板'}
      title="源代码管理"
      aria-pressed={sidePanelView === 'git'}
      onclick={() => onToggleSidePanel('git')}
    >
      <Icon name="branch" size={15} />
    </Button>
  </div>
</header>
