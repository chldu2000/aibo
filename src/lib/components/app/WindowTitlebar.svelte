<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';

  type WindowTitlebarProps = {
    onOpenSettings: () => void;
    onOpenDiagnostics: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
  };

  let { onOpenSettings, onOpenDiagnostics, inspectorOpen, onToggleInspector }: WindowTitlebarProps = $props();
</script>

<header class="window-titlebar" data-tauri-drag-region data-ui-component="window-titlebar">
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
