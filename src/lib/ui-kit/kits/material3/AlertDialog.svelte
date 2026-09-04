<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import Button from './Button.svelte';
  import Card from './Card.svelte';
  import CardContent from './CardContent.svelte';
  import CardHeader from './CardHeader.svelte';
  import CardTitle from './CardTitle.svelte';

  type AlertDialogProps = HTMLAttributes & {
    open?: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  };

  let {
    open = false,
    title,
    description,
    confirmText = '确认',
    cancelText = '取消',
    onConfirm,
    onCancel,
    class: className,
    ...restProps
  }: AlertDialogProps = $props();
</script>

{#if open}
  <div class="m3-aibo-alert-overlay" role="presentation" onclick={() => onCancel?.()}>
    <Card
      class={cn('m3-aibo-alert-dialog', className)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="m3-aibo-alert-dialog-title"
      {...restProps}
      onclick={(event) => event.stopPropagation()}
    >
      <CardHeader class="m3-aibo-alert-header">
        <CardTitle id="m3-aibo-alert-dialog-title">{title}</CardTitle>
      </CardHeader>
      {#if description}
        <CardContent class="m3-aibo-alert-content">{description}</CardContent>
      {/if}
      <div class="m3-aibo-alert-actions">
        <Button variant="ghost" type="button" onclick={() => onCancel?.()}>{cancelText}</Button>
        <Button type="button" onclick={() => onConfirm?.()}>{confirmText}</Button>
      </div>
    </Card>
  </div>
{/if}
