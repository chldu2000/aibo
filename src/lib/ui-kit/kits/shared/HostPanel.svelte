<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiHostPanelProps } from '../../contract';
  let { title, backLabel, onBack, onClose, actions, children }: UiHostPanelProps = $props();
  const id = $props.id();
  let panel: HTMLElement;
  let heading: HTMLHeadingElement;
  let body: HTMLDivElement;
  const positions = new Map<string, number>();
  let previousTitle: string | undefined;
  function rememberScroll() { if (previousTitle && body) positions.set(previousTitle, body.scrollTop); }
  onMount(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading?.focus();
    return () => { void tick().then(() => { if (!document.querySelector('[role="dialog"],[role="alertdialog"]') && trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus(); }); };
  });
  $effect(() => {
    const next = title;
    if (body) {
      previousTitle = next;
      const position = positions.get(next) ?? 0;
      let cancelled = false;
      void tick().then(() => { if (!cancelled && body) { body.scrollTop = position; heading?.focus(); } });
      return () => { cancelled = true; };
    }
  });
  function keydown(event: KeyboardEvent) {
    // Native dialogs and the palette own the keyboard while they are on top; skin class names stay out of shared code.
    if (event.defaultPrevented || [...document.querySelectorAll<HTMLElement>('dialog[open],.command-palette-overlay,[role="alertdialog"]')].some(node => node.getClientRects().length)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    // Host approvals stay in the keyboard loop even while the workbench is inert.
    const candidates = [...panel.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'),
      ...document.querySelectorAll<HTMLElement>('.approval-list button')]
      .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden],[inert]') && node.getClientRects().length);
    event.preventDefault();
    if (!candidates.length) { heading.focus(); return; }
    const index = candidates.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (event.shiftKey ? candidates.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
    candidates[next].focus();
  }
</script>

<svelte:window onkeydown={keydown} />
<div class="host-panel-overlay">
  <div bind:this={panel} tabindex="-1" class="host-panel" role="dialog" aria-labelledby={id} data-ui-component="host-panel">
    <header class="host-panel-header">
      {#if onBack}<Button variant="ghost" size="sm" onclick={onBack}>← {backLabel}</Button>{/if}
      <h2 id={id} bind:this={heading} tabindex="-1">{title}</h2>
      {@render actions?.()}
      <Button variant="ghost" size="icon" aria-label={`关闭${title}`} title="关闭" onclick={onClose}><Icon name="close" size={16} /></Button>
    </header>
    <div bind:this={body} class="host-panel-body" onscroll={rememberScroll}>{@render children()}</div>
  </div>
</div>
