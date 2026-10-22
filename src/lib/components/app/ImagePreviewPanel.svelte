<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Button, HostPanel, Icon } from '$lib/ui-kit';
  import type { ImagePreviewState } from '$lib/app/image-preview-controller';
  let { state: preview, onClose, onRetry, onSave, saving = false }: { state: NonNullable<ImagePreviewState>; onClose: () => void; onRetry: () => void; onSave: () => void; saving?: boolean } = $props();
  let originalSize = $state(false);
  let failed = $state(false);
  const sizeLabel = $derived($t(originalSize ? 'attachments.fitImage' : 'attachments.originalSize'));
  $effect(() => { preview.url; failed = false; originalSize = false; });
</script>

<HostPanel title={$t('attachments.imagePreview', { name: preview.name })} {onClose}>
  {#snippet actions()}
    {#if preview.error || failed}
      <Button variant="ghost" size="icon" title={$t('common.retry')} aria-label={$t('common.retry')} onclick={onRetry}><Icon name="refresh" size={18} /></Button>
    {:else if preview.url}
      <Button variant="ghost" size="icon" title={sizeLabel} aria-label={sizeLabel} onclick={() => { originalSize = !originalSize; }}><Icon name={originalSize ? 'focus' : 'window-maximize'} size={18} /></Button>
      <Button variant="ghost" size="icon" title={$t('attachments.saveAs')} aria-label={$t('attachments.saveAs')} disabled={saving} onclick={onSave}><Icon name="download" size={18} /></Button>
    {/if}
  {/snippet}
  {#if preview.error || failed}
    <div class="image-preview-status" role="alert"><Icon name="warning" size={32} /><p>{preview.error ? translateMessage($locale, preview.error) : $t('attachments.previewFailed')}</p></div>
  {:else if preview.url}
    <div class="image-preview-content" class:original-size={originalSize}>
      <img src={preview.url} alt={preview.name} onerror={() => { failed = true; }} />
    </div>
  {:else}<div class="image-preview-status" role="status"><Icon name="image" size={32} /><p>{$t('attachments.loading')}</p></div>{/if}
</HostPanel>

<style>
  .image-preview-content { display: flex; justify-content: center; align-items: center; overflow: auto; height: 100%; padding: 24px; box-sizing: border-box; }
  .image-preview-content img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .image-preview-content.original-size { display: block; }
  .image-preview-content.original-size img { max-width: none; max-height: none; }
  .image-preview-status { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; padding: 24px; box-sizing: border-box; text-align: center; }
</style>
