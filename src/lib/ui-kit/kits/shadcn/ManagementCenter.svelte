<script lang="ts">
  import type { UiManagementCenterProps, UiManagementSection } from '../../contract';
  import { Button } from '$lib/components/ui/button';
  import Icon from './Icon.svelte';
  let { title, activeSection, onSelectSection, onClose, appearance, extensions, runtime, footer }: UiManagementCenterProps = $props();
  const sections: readonly { id: UiManagementSection; label: string; description: string }[] = [
    { id: 'appearance', label: '外观', description: '皮肤、主题与布局' },
    { id: 'extensions', label: '扩展', description: '插件与能力来源' },
    { id: 'runtime', label: '运行状态', description: 'Agent、环境与诊断' },
  ];
</script>

<div class="management-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <div class="management-shell" role="dialog" aria-modal="true" aria-labelledby="management-title">
    <header class="management-header">
      <div><small>AIBO</small><h1 id="management-title">{title}</h1></div>
      <Button variant="ghost" size="icon" aria-label="关闭管理中心" title="关闭" onclick={onClose}><Icon name="close" size={16} /></Button>
    </header>
    <div class="management-body">
      <div class="management-nav" aria-label="管理中心栏目" role="tablist" aria-orientation="vertical">
        {#each sections as section (section.id)}
          <button type="button" role="tab" aria-selected={activeSection === section.id} class:active={activeSection === section.id} onclick={() => onSelectSection(section.id)}>
            <strong>{section.label}</strong><small>{section.description}</small>
          </button>
        {/each}
      </div>
      <div class="management-content" role="tabpanel" aria-label={sections.find(section => section.id === activeSection)?.label}>
        {#if activeSection === 'appearance'}{@render appearance()}{:else if activeSection === 'extensions'}{@render extensions()}{:else}{@render runtime()}{/if}
      </div>
    </div>
    {#if footer}<footer class="management-footer">{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .management-overlay { position: fixed; z-index: 30; inset: 0; display: grid; place-items: center; padding: 3rem; background: #0009; }
  .management-shell { width: min(64rem, 100%); height: min(44rem, calc(100vh - 6rem)); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid var(--aibo-border-strong); border-radius: 0.75rem; background: var(--aibo-surface); box-shadow: 0 1.5rem 5rem #0009; }
  .management-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--aibo-border); }
  .management-header small { color: var(--aibo-subtle); font-size: 0.6rem; font-weight: 600; letter-spacing: .14em; }
  .management-header h1 { margin: .15rem 0 0; color: var(--aibo-text); font-size: 1rem; line-height: 1.2; }
  .management-body { display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); min-height: 0; }
  .management-nav { display: flex; flex-direction: column; gap: .25rem; padding: 1rem .75rem; border-right: 1px solid var(--aibo-border); background: var(--aibo-bg); }
  .management-nav button { display: grid; gap: .2rem; border: 0; border-radius: .4rem; padding: .65rem .75rem; color: var(--aibo-muted); background: transparent; text-align: left; }
  .management-nav button:hover { background: var(--aibo-surface-hover); }
  .management-nav button.active { color: var(--aibo-text); background: var(--aibo-accent-soft); box-shadow: inset 2px 0 0 var(--aibo-accent); }
  .management-nav strong { font-size: .72rem; font-weight: 600; }
  .management-nav small { color: var(--aibo-subtle); font-size: .6rem; line-height: 1.35; }
  .management-nav button:focus-visible { outline: 2px solid var(--aibo-focus); outline-offset: -2px; }
  .management-content { min-width: 0; overflow-y: auto; padding: 1.5rem 0 2rem; }
  .management-content :global(.settings-tab-panel) { width: min(100%, 46rem); margin-inline: auto; }
  .management-content :global(.settings-section-heading) { padding-inline: 1.5rem; }
  .management-content :global(.appearance-kit-grid), .management-content :global(.appearance-theme-grid) { padding-inline: 1.5rem; }
  .management-content :global(.plugin-manager > p) { max-width: 62ch; color: var(--aibo-subtle); line-height: 1.55; }
  .management-content :global(.plugin-install) { padding: 1rem; border: 1px solid var(--aibo-border); border-radius: .5rem; background: var(--aibo-bg); }
  .management-content :global(.settings-agent-cards) { padding-inline: 1.5rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .management-content :global(.management-runtime-actions) { display: flex; justify-content: flex-end; padding-inline: 1.5rem; }
  .management-footer { display: flex; justify-content: flex-end; padding: .75rem 1.25rem; border-top: 1px solid var(--aibo-border); }
  @media (max-width: 720px) {
    .management-overlay { padding: var(--aibo-titlebar-height) 0 0; place-items: stretch; }
    .management-shell { width: 100%; height: 100%; border-radius: 0; }
    .management-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
    .management-nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--aibo-border); }
    .management-nav button { min-width: 8rem; }
    .management-content :global(.settings-agent-cards) { grid-template-columns: 1fr; }
  }
</style>
