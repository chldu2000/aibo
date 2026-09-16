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
<style>
  dialog { margin:auto; width:min(880px,calc(100vw - 32px)); height:min(760px,calc(100dvh - 48px)); max-width:none; max-height:none; padding:0; border:1px solid var(--aibo-border); border-radius:16px; color:var(--aibo-text); background:var(--aibo-surface); box-shadow:0 24px 80px #0006; }
  dialog[open] { display:flex; flex-direction:column; }
  dialog::backdrop { background:#0008; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 20px; border-bottom:1px solid var(--aibo-border); }
  header div { display:flex; align-items:center; gap:16px; min-width:0; }
  strong { font-size:16px; overflow-wrap:anywhere; }
  header span { font-size:12px; color:var(--aibo-muted); }
  .task { padding:12px 20px; font-size:12px; border-bottom:1px solid var(--aibo-border); }
  summary { cursor:pointer; }
  p { max-height:140px; overflow:auto; white-space:pre-wrap; line-height:1.6; }
  .body { display:flex; flex:1; min-height:0; flex-direction:column; overflow:hidden; }
</style>
