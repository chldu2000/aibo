<script lang="ts">
  import type { UiManagementCenterProps, UiManagementSection } from '../../contract';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  let { title, activeSection, onSelectSection, onClose, appearance, extensions, runtime, footer }: UiManagementCenterProps = $props();
  const sections: readonly { id: UiManagementSection; label: string }[] = [
    { id: 'appearance', label: '外观' }, { id: 'extensions', label: '扩展' }, { id: 'runtime', label: '运行状态' },
  ];
</script>

<div class="management-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <div class="management-shell" role="dialog" aria-modal="true" aria-labelledby="management-title">
    <header class="management-header">
      <div><p>设备与应用</p><h1 id="management-title">{title}</h1></div>
      <Button variant="ghost" size="icon" aria-label="关闭管理中心" title="关闭" onclick={onClose}><Icon name="close" size={20} /></Button>
    </header>
    <div class="management-nav" aria-label="管理中心栏目" role="tablist">
      {#each sections as section (section.id)}
        <button type="button" role="tab" aria-selected={activeSection === section.id} class:active={activeSection === section.id} onclick={() => onSelectSection(section.id)}>{section.label}</button>
      {/each}
    </div>
    <div class="management-content" role="tabpanel" aria-label={sections.find(section => section.id === activeSection)?.label}>
      {#if activeSection === 'appearance'}{@render appearance()}{:else if activeSection === 'extensions'}{@render extensions()}{:else}{@render runtime()}{/if}
    </div>
    {#if footer}<footer class="management-footer">{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .management-overlay { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 2.5rem; background: #00000073; }
  .management-shell { width: min(66rem, 100%); height: min(46rem, calc(100vh - 5rem)); display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; overflow: hidden; border-radius: 1.75rem; color: var(--aibo-text); background: var(--aibo-surface); box-shadow: 0 1.5rem 4.5rem #0006; }
  .management-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 1.75rem 1rem; }
  .management-header p { margin: 0 0 .2rem; color: var(--aibo-subtle); font-size: .7rem; font-weight: 500; }
  .management-header h1 { margin: 0; font-size: 1.5rem; font-weight: 500; line-height: 1.25; }
  .management-nav { display: flex; gap: .35rem; margin: 0 1.75rem .75rem; padding: .3rem; border-radius: 1.5rem; background: var(--aibo-bg); }
  .management-nav button { flex: 1; min-height: 2.5rem; border: 0; border-radius: 1.25rem; padding: .5rem 1rem; color: var(--aibo-muted); background: transparent; font-size: .78rem; font-weight: 500; }
  .management-nav button:hover { background: var(--aibo-surface-hover); }
  .management-nav button.active { color: var(--aibo-text); background: var(--aibo-accent-soft); }
  .management-nav button:focus-visible { outline: 3px solid var(--aibo-focus); outline-offset: 2px; }
  .management-content { min-width: 0; overflow-y: auto; padding: 1.25rem .5rem 2.25rem; }
  .management-content :global(.settings-tab-panel) { width: min(100%, 52rem); margin-inline: auto; gap: 1.5rem; }
  .management-content :global(.settings-section-heading) { padding-inline: 1.75rem; }
  .management-content :global(.appearance-kit-grid), .management-content :global(.appearance-theme-grid) { padding-inline: 1.75rem; }
  .management-content :global(.appearance-kit-option), .management-content :global(.appearance-theme-option) { border-radius: 1.25rem; }
  .management-content :global(.plugin-manager > p) { max-width: 62ch; color: var(--aibo-subtle); line-height: 1.6; }
  .management-content :global(.plugin-install) { padding: 1.25rem; border-radius: 1.5rem; background: var(--aibo-bg); }
  .management-content :global(.settings-agent-cards) { padding-inline: 1.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .management-content :global(.settings-agent-cards .agent-card) { border-radius: 1.5rem; }
  .management-content :global(.management-runtime-actions) { display: flex; justify-content: flex-end; padding-inline: 1.75rem; }
  .management-footer { display: flex; justify-content: flex-end; padding: .9rem 1.75rem 1.25rem; }
  @media (max-width: 720px) {
    .management-overlay { padding: var(--aibo-titlebar-height) 0 0; place-items: stretch; }
    .management-shell { width: 100%; height: 100%; border-radius: 0; }
    .management-header { padding-inline: 1.25rem; }
    .management-nav { margin-inline: 1rem; }
    .management-nav button { padding-inline: .5rem; }
    .management-content :global(.settings-agent-cards) { grid-template-columns: 1fr; }
  }
</style>
