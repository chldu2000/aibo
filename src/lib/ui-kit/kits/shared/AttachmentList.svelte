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
     {:else}<span class="attachment-placeholder">{previews[item.id] === null || failed[item.id] ? '图片无法预览' : '图片加载中…'}</span>{/if}
    {/if}
    <div class="attachment-caption"><span>{name(item.path)}</span>
     {#if onRemove}<button type="button" {disabled} aria-label={`移除附件 ${name(item.path)}`} onclick={() => onRemove?.(item.id)}>×</button>{/if}
    </div>
   </div>
  {/each}
 </div>
{/if}
<style>
 .attachment-list { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
 .attachment-item { max-width:200px; border:1px solid currentColor; border-radius:8px; overflow:hidden; }
 .attachment-item img { display:block; width:160px; height:112px; object-fit:contain; }
 .attachment-placeholder { display:grid; width:160px; height:112px; place-items:center; font-size:12px; opacity:.7; }
 .attachment-caption { display:flex; align-items:center; gap:8px; padding:5px 8px; font-size:12px; }
 .attachment-caption span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 button { flex:none; border:0; background:transparent; color:inherit; cursor:pointer; font-size:18px; }
 button:disabled { opacity:.5; cursor:default; }
 a:focus-visible,button:focus-visible { outline:2px solid currentColor; outline-offset:-2px; }
</style>
