<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSubagentDialogProps } from '../../contract';
  let {open, title, task, statusLabel, onClose, children}: UiSubagentDialogProps = $props();
  let dialog: HTMLDialogElement;
  $effect(() => { if (dialog) { if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); } });
  function backdrop(event: MouseEvent) { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }
</script>
<dialog bind:this={dialog} class="subagent-dialog" aria-label={$t('subagent.processLabel', { name: title })} oncancel={(event) => {event.preventDefault(); onClose();}} onclick={backdrop}>
  <header><div><strong>{title}</strong><span role="status">{statusLabel}</span></div><Button variant="ghost" size="icon" onclick={onClose} aria-label={$t('subagent.closeProcess')}><Icon name="close" size={18}/></Button></header>
  <details class="task"><summary>{$t('subagent.taskDescription')}</summary><p>{task || $t('subagent.noDescription')}</p></details>
  <section class="body">{@render children?.()}</section>
</dialog>
