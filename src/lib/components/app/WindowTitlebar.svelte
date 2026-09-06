<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';

  type WindowTitlebarProps = {
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
    onStartDragging: () => void;
  };

  let {
    onOpenSettings,
    onOpenDiagnostics,
    inspectorOpen,
    onToggleInspector,
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
      class={inspectorOpen ? 'active' : ''}
      variant="ghost"
      size="icon"
      type="button"
      aria-label={inspectorOpen ? '隐藏上下文面板' : '显示上下文面板'}
      title={inspectorOpen ? '隐藏上下文' : '显示上下文'}
      aria-pressed={inspectorOpen}
      onclick={onToggleInspector}
    >
      <Icon name="panel-right" size={15} />
    </Button>
  </div>
</header>
