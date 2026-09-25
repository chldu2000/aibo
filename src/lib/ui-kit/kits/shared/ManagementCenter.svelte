<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { UiManagementCenterProps, UiManagementSection } from '../../contract';
  import Button from './Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
  let { title, restoreTriggerFocus = true, activeSection, onSelectSection, onClose, appearance, layout, workspace, extensions, runtime, footer }: UiManagementCenterProps = $props();
  let dialog: HTMLDialogElement;
  // Capture before the sibling workbench becomes inert in this render.
  const previous = typeof document === 'undefined' ? null : document.activeElement;
  const previousFocus = typeof HTMLElement !== 'undefined' && previous instanceof HTMLElement ? previous.dataset.presentationFocus : undefined;
  const sections: readonly { id: UiManagementSection; label: string; description: string }[] = [
    { id: 'appearance', label: '外观', description: '主题与当前皮肤' },
    { id: 'layout', label: '布局', description: '侧边区域与工作台恢复' },
    { id: 'workspace', label: '工作区', description: '新增工作区的默认行为' },
    { id: 'extensions', label: '插件与能力', description: '安装管理与插件配置' },
    { id: 'runtime', label: '运行与诊断', description: '环境、连接与执行记录' },
  ];
  $effect(() => {
    activeSection;
    dialog?.querySelector<HTMLElement>('.management-content')?.scrollTo(0, 0);
  });
  let returnToTrigger = true;
  $effect(() => { returnToTrigger = restoreTriggerFocus; });
  onMount(() => {
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.management-content')?.scrollTo(0, 0);
    return () => {
      dialog.close();
      if (!(previous instanceof HTMLElement)) return;
      // Let the workbench finish its own focus recovery before returning to
      // a trigger inside it. Cross-presentation switches use semantic recovery.
      if (returnToTrigger) void tick().then(() => requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        // Layout changes remount navigation. Resolve the same host-owned entry
        // in the new generation; skin switches still use semantic view recovery.
        const trigger = previous.isConnected ? previous : previousFocus
          ? [...document.querySelectorAll<HTMLElement>('[data-presentation-focus]')].find(element => element.dataset.presentationFocus === previousFocus)
          : null;
        if (trigger?.getClientRects().length && !trigger.closest('[hidden],[inert]') && !trigger.matches(':disabled')) trigger.focus({ preventScroll: true });
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
<dialog bind:this={dialog} class="ui-management management-shell" aria-labelledby="management-title" oncancel={event => { event.preventDefault(); onClose(); }} onclick={event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
}}>
  <header class="management-header"><div><h1 id="management-title">{title}</h1></div><Button variant="ghost" size="icon" aria-label="关闭设置" onclick={onClose}><Icon name="close" /></Button></header>
  <div class="management-body">
    <div class="management-nav" role="tablist" aria-label="设置分类" aria-orientation="vertical">
      {#each sections as section, index (section.id)}
        <button type="button" class:management-tools-start={section.id === 'extensions'} id={`management-tab-${section.id}`} role="tab" aria-selected={activeSection === section.id} aria-controls="management-content" tabindex={activeSection === section.id ? 0 : -1} onclick={() => onSelectSection(section.id)} onkeydown={event => move(event, index)}><strong>{section.label}</strong><small>{section.description}</small></button>
      {/each}
    </div>
    <div class="management-content" id="management-content" role="tabpanel" aria-labelledby={`management-tab-${activeSection}`} tabindex="0">
      {#if activeSection === 'appearance'}{@render appearance()}{:else if activeSection === 'layout'}{@render layout()}{:else if activeSection === 'workspace'}{@render workspace()}{:else if activeSection === 'extensions'}{@render extensions()}{:else}{@render runtime()}{/if}
    </div>
  </div>
  {#if footer}<footer class="management-footer">{@render footer()}</footer>{/if}
</dialog>
