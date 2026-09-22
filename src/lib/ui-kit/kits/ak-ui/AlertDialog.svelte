<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import Button from './Button.svelte';
  let { open = false, title, description, confirmText = '确认', cancelText = '取消', onConfirm, onCancel, class: className = '', ...rest }: HTMLAttributes & {
    open?: boolean; title: string; description?: string; confirmText?: string; cancelText?: string;
    onConfirm?: () => void; onCancel?: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!open || !dialog) return;
    const element = dialog;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  });
</script>
{#if open}
<dialog bind:this={dialog} class={`ak-alert ${className}`} role="alertdialog" aria-labelledby="alert-dialog-title" aria-describedby={description ? 'alert-dialog-description' : undefined} {...rest} oncancel={event => { event.preventDefault(); onCancel?.(); }}>
  <h2 id="alert-dialog-title">{title}</h2>
  {#if description}<p id="alert-dialog-description">{description}</p>{/if}
  <div class="alert-dialog-actions"><Button variant="ghost" onclick={() => onCancel?.()}>{cancelText}</Button><Button variant="destructive" onclick={() => onConfirm?.()}>{confirmText}</Button></div>
</dialog>
{/if}
