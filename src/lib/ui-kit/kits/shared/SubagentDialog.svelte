<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSubagentDialogProps } from '../../contract';
  let {open, title, task, statusLabel, onClose, children}: UiSubagentDialogProps = $props();
  let dialog: HTMLDialogElement;
  $effect(() => { if (dialog) { if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); } });
  function backdrop(event: MouseEvent) { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }
</script>
<dialog bind:this={dialog} class="subagent-dialog" aria-label={`${title} 的工作过程`} oncancel={(event) => {event.preventDefault(); onClose();}} onclick={backdrop}>
  <header><div><strong>{title}</strong><span role="status">{statusLabel}</span></div><Button variant="ghost" size="icon" onclick={onClose} aria-label="关闭工作过程"><Icon name="close" size={18}/></Button></header>
  <details class="task"><summary>任务说明</summary><p>{task || '未提供任务说明'}</p></details>
  <section class="body">{@render children?.()}</section>
</dialog>
