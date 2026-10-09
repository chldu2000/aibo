<script lang="ts">
  import { t } from '$lib/i18n/runtime';
 import Icon from '../../runtime/Icon.svelte';
 import type { UiAttachmentListProps } from '../../contract';
 let { items, previews = {}, onRemove, disabled = false }: UiAttachmentListProps = $props();
 let failed = $state<Record<string, boolean>>({});
 const name = (path: string) => path.split(/[\\/]/).pop() || path;
</script>
{#if items.length}
 <div class="attachment-list" aria-label={onRemove ? $t('inspector.attachments') : $t('attachments.messages')}>
  {#each items as item (item.id)}
   <div class="attachment-item" title={item.displayName ?? item.path}>
    {#if item.mediaType?.startsWith('image/')}
     {#if previews[item.id] && !failed[item.id]}
      <a href={previews[item.id] ?? undefined} download={name(item.path)} title={$t('attachments.saveImage', { name: name(item.path) })}>
       <img src={previews[item.id] ?? undefined} alt={name(item.path)} loading="lazy" onerror={() => { failed = {...failed, [item.id]:true}; }} />
      </a>
     {:else}<span class="attachment-placeholder" role="img" aria-label={previews[item.id] === null || failed[item.id] ? $t('attachments.previewFailed') : $t('attachments.loading')} title={previews[item.id] === null || failed[item.id] ? $t('attachments.previewFailed') : $t('attachments.loading')}><Icon name={previews[item.id] === null || failed[item.id] ? 'warning' : 'image'} size={14} /></span>{/if}
    {:else}<span class="attachment-file-icon" aria-hidden="true"><Icon name="file" size={14} /></span>{/if}
    <div class="attachment-caption"><span>{item.displayName ?? name(item.path)}</span>{#if item.sizeLabel}<span class="attachment-size">{item.sizeLabel}</span>{/if}
     {#if onRemove}<button type="button" {disabled} aria-label={$t('attachments.remove', { name: item.displayName ?? name(item.path) })} onclick={() => onRemove?.(item.id)}><Icon name="close" size={12} /></button>{/if}
    </div>
   </div>
  {/each}
 </div>
{/if}
