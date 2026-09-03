<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { cn } from '$lib/utils';

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
  <div class="alert-dialog-overlay" role="presentation" onclick={() => onCancel?.()}>
    <Card
      class={cn('alert-dialog', className)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-dialog-title"
      {...restProps}
      onclick={(event) => event.stopPropagation()}
    >
      <CardHeader class="alert-dialog-header">
        <CardTitle id="alert-dialog-title">{title}</CardTitle>
      </CardHeader>
      {#if description}
        <CardContent class="alert-dialog-content">{description}</CardContent>
      {/if}
      <div class="alert-dialog-actions">
        <Button variant="ghost" type="button" onclick={() => onCancel?.()}>{cancelText}</Button>
        <Button variant="destructive" type="button" onclick={() => onConfirm?.()}>{confirmText}</Button>
      </div>
    </Card>
  </div>
{/if}
