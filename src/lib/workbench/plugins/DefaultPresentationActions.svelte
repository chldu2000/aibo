<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';
  let { surface, layout, switching, onSwitchLayout, onRestore, onOpenExecutionHistory, onOpenSessionHistory }: {
    surface: 'conversation' | 'navigation' | 'diagnostics' | 'appearance';
    layout: string;
    switching: boolean;
    onSwitchLayout: (layout: string) => void;
    onRestore: () => void;
    onOpenExecutionHistory: () => void;
    onOpenSessionHistory: () => void;
  } = $props();
</script>

{#if surface === 'conversation'}
  <Button variant="ghost" size="icon" aria-label="专注会话" title={layout === 'focus' ? '退出专注会话' : '专注会话'} aria-pressed={layout === 'focus'} disabled={switching} onclick={() => onSwitchLayout(layout === 'focus' ? 'standard' : 'focus')}>
    <Icon name="focus" size={16} />
  </Button>
{:else if surface === 'navigation'}
  <Button variant="ghost" size="icon" aria-label="会话历史" title="会话历史" onclick={onOpenSessionHistory}><Icon name="archive" size={16} /></Button>
{:else if surface === 'diagnostics'}
  <section class="settings-section" aria-label="执行记录">
    <h2>执行记录</h2>
    <Button variant="outline" onclick={onOpenExecutionHistory}>执行历史</Button>
  </section>
{:else if surface === 'appearance'}
  <section class="settings-section" aria-label="工作台布局">
    <h2>工作台布局</h2>
    <Button variant="ghost" aria-label="交换工作台侧边区域" disabled={switching} onclick={() => onSwitchLayout(layout === 'review' ? 'standard' : 'review')}>{layout === 'review' ? '导航移到左侧' : '导航移到右侧'}</Button>
    <Button variant="ghost" aria-label="恢复默认呈现" aria-keyshortcuts="Control+Shift+Backspace Meta+Shift+Backspace" onclick={onRestore}>恢复默认呈现</Button>
    <p>恢复快捷键：Ctrl / ⌘ + Shift + Backspace</p>
  </section>
{/if}
