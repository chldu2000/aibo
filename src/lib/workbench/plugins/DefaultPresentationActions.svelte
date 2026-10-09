<script lang="ts">
  import { t } from '$lib/i18n/runtime';
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
  <Button variant="ghost" size="icon" aria-label={$t('workbench.focus')} title={layout === 'focus' ? $t('workbench.exitFocus') : $t('workbench.focus')} aria-pressed={layout === 'focus'} disabled={switching} onclick={() => onSwitchLayout(layout === 'focus' ? 'standard' : 'focus')}>
    <Icon name="focus" size={16} />
  </Button>
{:else if surface === 'diagnostics'}
  <SettingsSection title={$t('workbench.executions')} items={[{
    id: 'history', title: $t('workbench.executionHistory'), description: $t('workbench.executionHistoryDescription'), icon: 'archive',
    actions: [{ id: 'open', label: $t('workbench.openExecutionHistory'), intent: 'navigate' }],
  }]} onAction={onOpenExecutionHistory} />
{:else if surface === 'layout'}
  <SettingsSection title={$t('workbench.layout')} items={[
    { id: 'layout', title: $t('workbench.sideAreas'), description: $t('workbench.sideAreasDescription'), icon: 'panel-right',
      actions: [{ id: 'swap', label: layout === 'review' ? $t('workbench.navigationLeft') : $t('workbench.navigationRight'), ariaLabel: $t('workbench.swapSides'), intent: 'layout', disabled: switching }] },
    { id: 'standard', title: $t('workbench.standard'), description: $t('workbench.standardDescription'), icon: 'panel-right',
      actions: [{ id: 'standard', label: $t('workbench.restoreStandard'), intent: 'layout', disabled: switching || layout === 'standard' }] },
    { id: 'recovery', title: $t('workbench.recovery'), description: $t('workbench.recoveryDescription'), icon: 'undo', shortcut: 'Ctrl / ⌘ + Shift + Backspace',
      actions: [{ id: 'restore', label: $t('workbench.restoreDefault'), intent: 'restore', keyShortcuts: 'Control+Shift+Backspace Meta+Shift+Backspace' }] },
  ]} onAction={(item) => item === 'layout' ? onSwitchLayout(layout === 'review' ? 'standard' : 'review') : item === 'standard' ? onSwitchLayout('standard') : onRestore()} />
{/if}
