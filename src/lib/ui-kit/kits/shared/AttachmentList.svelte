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
    {:else}<span class="attachment-file-icon" aria-hidden="true">▤</span>{/if}
    <div class="attachment-caption"><span>{name(item.path)}</span>
     {#if onRemove}<button type="button" {disabled} aria-label={`移除附件 ${name(item.path)}`} onclick={() => onRemove?.(item.id)}>×</button>{/if}
    </div>
   </div>
  {/each}
 </div>
{/if}
<style>
 .attachment-list { display:flex; flex-wrap:wrap; align-items:flex-start; gap:8px; margin:8px 0; }
 .attachment-item { display:flex; align-items:center; gap:8px; width:220px; max-width:100%; min-width:0; height:56px; padding:6px; border:1px solid var(--aibo-border); border-radius:6px; background:var(--aibo-surface); overflow:hidden; }
 .attachment-item a { flex:none; }
 .attachment-item img { display:block; width:42px; height:42px; object-fit:contain; background:var(--aibo-surface-hover); border-radius:3px; }
 .attachment-placeholder, .attachment-file-icon { display:grid; flex:none; width:42px; height:42px; place-items:center; background:var(--aibo-surface-hover); color:var(--aibo-muted); border-radius:3px; }
 .attachment-placeholder { font-size:10px; text-align:center; line-height:1.3; }
 .attachment-file-icon { font-size:24px; }
 .attachment-caption { display:flex; flex:1; min-width:0; align-items:center; gap:4px; font-size:12px; }
 .attachment-caption span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 button { display:grid; place-items:center; width:24px; height:28px; padding:0; flex:none; border:0; border-radius:3px; background:transparent; color:var(--aibo-muted); cursor:pointer; font-size:18px; }
 button:hover { background:var(--aibo-surface-hover); color:var(--aibo-text); }
 button:disabled { opacity:.5; cursor:default; }
 a:focus-visible,button:focus-visible { outline:2px solid var(--aibo-accent); outline-offset:-2px; }
</style>
