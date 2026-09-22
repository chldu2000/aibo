<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { UiManagementCenterProps, UiManagementSection } from '../../contract';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  let { title, restoreTriggerFocus = true, activeSection, onSelectSection, onClose, appearance, extensions, runtime, footer }: UiManagementCenterProps = $props();
  let dialog: HTMLDialogElement;
  // Capture before the sibling workbench becomes inert in this render.
  const previous = typeof document === 'undefined' ? null : document.activeElement;
  const sections: readonly { id: UiManagementSection; label: string; description: string }[] = [
    { id: 'appearance', label: '外观', description: '主题与工作台布局' },
    { id: 'extensions', label: '扩展', description: '插件与能力来源' },
    { id: 'runtime', label: '运行状态', description: '环境与诊断' },
  ];
  let returnToTrigger = true;
  $effect(() => { returnToTrigger = restoreTriggerFocus; });
  onMount(() => {
    dialog.showModal();
    return () => {
      dialog.close();
      if (!(previous instanceof HTMLElement) || !previous.isConnected) return;
      // Let the workbench finish its own focus recovery before returning to
      // a trigger inside it. Cross-presentation switches use semantic recovery.
      if (returnToTrigger) void tick().then(() => requestAnimationFrame(() => {
        if (previous.isConnected && !document.querySelector('dialog[open]')) previous.focus({ preventScroll: true });
      }));
      else if (document.activeElement === previous) previous.blur();
    };
  });
  function move(event: KeyboardEvent, index: number) {
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault(); onSelectSection(sections[next].id);
    dialog.querySelector<HTMLButtonElement>(`#management-tab-${sections[next].id}`)?.focus();
  }
</script>
<dialog bind:this={dialog} class="ak-management management-shell" aria-labelledby="management-title" oncancel={event => { event.preventDefault(); onClose(); }} onclick={event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
}}>
  <header class="management-header"><div><small>PREFERENCES</small><h1 id="management-title">{title}</h1></div><Button variant="ghost" size="icon" aria-label="关闭管理中心" onclick={onClose}><Icon name="close" /></Button></header>
  <div class="management-body">
    <div class="management-nav" role="tablist" aria-label="管理中心栏目" aria-orientation="vertical">
      {#each sections as section, index (section.id)}
        <button type="button" id={`management-tab-${section.id}`} role="tab" aria-selected={activeSection === section.id} aria-controls="management-content" tabindex={activeSection === section.id ? 0 : -1} onclick={() => onSelectSection(section.id)} onkeydown={event => move(event, index)}><strong>{section.label}</strong><small>{section.description}</small></button>
      {/each}
    </div>
    <div class="management-content" id="management-content" role="tabpanel" aria-labelledby={`management-tab-${activeSection}`} tabindex="0">
      {#if activeSection === 'appearance'}{@render appearance()}{:else if activeSection === 'extensions'}{@render extensions()}{:else}{@render runtime()}{/if}
    </div>
  </div>
  {#if footer}<footer class="management-footer">{@render footer()}</footer>{/if}
</dialog>
