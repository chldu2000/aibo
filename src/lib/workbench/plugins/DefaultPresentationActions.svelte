<script lang="ts">
  import { Button, Icon, SettingsSection } from '$lib/ui-kit';
  let { surface, layout, switching, onSwitchLayout, onRestore, onOpenExecutionHistory }: {
    surface: 'conversation' | 'navigation' | 'diagnostics' | 'layout';
    layout: string;
    switching: boolean;
    onSwitchLayout: (layout: string) => void;
    onRestore: () => void;
    onOpenExecutionHistory: () => void;
  } = $props();
</script>

{#if surface === 'conversation'}
  <Button variant="ghost" size="icon" aria-label="专注会话" title={layout === 'focus' ? '退出专注会话' : '专注会话'} aria-pressed={layout === 'focus'} disabled={switching} onclick={() => onSwitchLayout(layout === 'focus' ? 'standard' : 'focus')}>
    <Icon name="focus" size={16} />
  </Button>
{:else if surface === 'diagnostics'}
  <SettingsSection title="执行记录" items={[{
    id: 'history', title: '执行历史', description: '查看工程任务、工作区写入与插件调用记录。', icon: 'archive',
    actions: [{ id: 'open', label: '执行历史', intent: 'navigate' }],
  }]} onAction={onOpenExecutionHistory} />
{:else if surface === 'layout'}
  <SettingsSection title="工作台布局" items={[
    { id: 'layout', title: '侧边区域', description: '调整工作区导航与辅助面板的位置。', icon: 'panel-right',
      actions: [{ id: 'swap', label: layout === 'review' ? '导航移到左侧' : '导航移到右侧', ariaLabel: '交换工作台侧边区域', intent: 'layout', disabled: switching }] },
    { id: 'standard', title: '标准布局', description: '恢复导航在左、辅助面板在右的布局，保留当前皮肤。', icon: 'panel-right',
      actions: [{ id: 'standard', label: '恢复标准布局', intent: 'layout', disabled: switching || layout === 'standard' }] },
    { id: 'recovery', title: '工作台恢复', description: '恢复内置皮肤与标准布局，保留会话和草稿。', icon: 'undo', shortcut: 'Ctrl / ⌘ + Shift + Backspace',
      actions: [{ id: 'restore', label: '恢复默认工作台', intent: 'restore', keyShortcuts: 'Control+Shift+Backspace Meta+Shift+Backspace' }] },
  ]} onAction={(item) => item === 'layout' ? onSwitchLayout(layout === 'review' ? 'standard' : 'review') : item === 'standard' ? onSwitchLayout('standard') : onRestore()} />
{/if}
