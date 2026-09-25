<script lang="ts">
 import type { UiAttachmentListProps } from '../../contract';
 let { items, previews = {}, onRemove, disabled = false }: UiAttachmentListProps = $props();
 let failed = $state<Record<string, boolean>>({});
 const name = (path: string) => path.split(/[\\/]/).pop() || path;
</script>
{#if items.length}
 <div class="attachment-list" aria-label={onRemove ? '上下文附件' : '消息附件'}>
  {#each items as item (item.id)}
   <div class="attachment-item" title={item.path}>
    {#if item.mediaType?.startsWith('image/')}
     {#if previews[item.id] && !failed[item.id]}
      <a href={previews[item.id] ?? undefined} download={name(item.path)} title={`保存图片 ${name(item.path)}`}>
       <img src={previews[item.id] ?? undefined} alt={name(item.path)} loading="lazy" onerror={() => { failed = {...failed, [item.id]:true}; }} />
      </a>
     {:else}<span class="attachment-placeholder" role="img" aria-label={previews[item.id] === null || failed[item.id] ? '图片无法预览' : '图片加载中'} title={previews[item.id] === null || failed[item.id] ? '图片无法预览' : '图片加载中'}>{previews[item.id] === null || failed[item.id] ? '!' : '…'}</span>{/if}
    {:else}<span class="attachment-file-icon" aria-hidden="true">▤</span>{/if}
    <div class="attachment-caption"><span>{name(item.path)}</span>{#if item.sizeLabel}<span class="attachment-size">{item.sizeLabel}</span>{/if}
     {#if onRemove}<button type="button" {disabled} aria-label={`移除附件 ${name(item.path)}`} onclick={() => onRemove?.(item.id)}>×</button>{/if}
    </div>
   </div>
  {/each}
 </div>
{/if}
