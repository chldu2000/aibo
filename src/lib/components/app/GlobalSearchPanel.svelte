<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button, Icon, Input } from '$lib/ui-kit';
  import { parseSearch, searchKinds, searchKindLabels, type SearchState, type SearchKind, type SearchResult } from '$lib/app/global-search';
  let { state: search, workspaces, onSearch, onActivate, onClose, preview, previewLoading, previewError, onBack, onOpenContext }: {
    state: SearchState; workspaces: { id: string; label: string }[];
    onSearch: (query: string, kind: SearchKind | null, workspaceId: string | null, limit?: number) => void;
    onActivate: (item: SearchResult) => void; onClose: () => void;
    preview: { title: string; content: string; truncated: boolean } | null;
    previewLoading: boolean; previewError: string; onBack: () => void; onOpenContext?: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let selectedId = $state<string | null>(null);
  const parsed = $derived(parseSearch(search.query, search.kind));
  const groups = $derived(searchKinds.map(kind => ({ kind, items: search.items.filter(item => item.kind === kind) })).filter(group => group.items.length));
  const visible = $derived(groups.flatMap(group => parsed.kind ? group.items : group.items.slice(0, 5)));
  const activeId = $derived(visible.some(item => item.id === selectedId) ? selectedId : visible[0]?.id ?? null);
  const inPreview = $derived(preview !== null || previewLoading || Boolean(previewError));
  function parts(text: string) {
    const query = parsed.query.toLocaleLowerCase();
    const index = query ? text.toLocaleLowerCase().indexOf(query) : -1;
    return index < 0 ? [text, '', ''] : [text.slice(0, index), text.slice(index, index + query.length), text.slice(index + query.length)];
  }
  onMount(() => {
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus();
    return () => { dialog?.close(); };
  });
  $effect(() => {
    if (!preview) return;
    void tick().then(() => dialog?.querySelector('.global-search-preview mark')?.scrollIntoView({ block: 'center' }));
  });
  function selectKind(kind: SearchKind | null) {
    selectedId = null;
    onBack();
    onSearch(parsed.query, kind, search.workspaceId);
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey
      && (target.id === 'global-search-input' || target.closest('.global-search-categories'))) {
      event.preventDefault(); event.stopPropagation();
      const kinds: (SearchKind | null)[] = [null, ...searchKinds];
      const index = kinds.indexOf(parsed.kind);
      selectKind(kinds[(index + (event.shiftKey ? -1 : 1) + kinds.length) % kinds.length]);
      dialog.querySelector<HTMLInputElement>('#global-search-input')?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (inPreview) onBack(); else onClose();
      return;
    }
    if (inPreview || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || (event.target as HTMLElement).tagName === 'SELECT') return;
    if (event.key === 'Enter' && event.target !== dialog.querySelector('input')) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') {
      const item = visible.find(item => item.id === activeId);
      if (item && !item.disabledReason) onActivate(item);
      return;
    }
    const index = visible.findIndex(item => item.id === activeId);
    const next = visible[(index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length];
    selectedId = next?.id ?? null;
    void tick().then(() => dialog.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#snippet highlighted(text: string)}
  {@const fragments = parts(text)}
  {fragments[0]}{#if fragments[1]}<mark>{fragments[1]}</mark>{/if}{fragments[2]}
{/snippet}

<dialog bind:this={dialog} class="global-search" aria-label="全局搜索" onkeydown={keydown}
  oncancel={(event) => { event.preventDefault(); onClose(); }}
  onclick={(event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
  <div class="global-search-heading">
    <Icon name="search" size={18} />
    <Input id="global-search-input" value={search.query} placeholder="搜索工作区、会话、消息、文件或命令…" aria-label="全局搜索内容"
      aria-describedby="global-search-keyboard" aria-keyshortcuts="Tab Shift+Tab"
      role="combobox" aria-autocomplete="list" aria-expanded={!inPreview} aria-controls="global-search-results" aria-activedescendant={inPreview ? undefined : activeId ? `search-result-${encodeURIComponent(activeId)}` : undefined}
      oninput={(event) => { selectedId = null; onBack(); onSearch(event.currentTarget.value, search.kind, search.workspaceId); }} />
    <Button variant="ghost" size="icon" aria-label="关闭全局搜索" onclick={onClose}><Icon name="close" size={16} /></Button>
  </div>
  <div class="global-search-toolbar">
    <div class="global-search-categories" aria-label="搜索类别">
      <Button variant="ghost" aria-pressed={!parsed.kind} onclick={() => selectKind(null)}>全部</Button>
      {#each searchKinds as kind}
        <Button variant="ghost" aria-pressed={parsed.kind === kind} onclick={() => selectKind(kind)}>{searchKindLabels[kind]}</Button>
      {/each}
    </div>
    <select aria-label="搜索范围" value={search.workspaceId ?? ''} onchange={(event) => { onBack(); onSearch(search.query, search.kind, event.currentTarget.value || null); }}>
      <option value="">全部工作区</option>
      {#each workspaces as workspace}<option value={workspace.id}>{workspace.label}</option>{/each}
    </select>
  </div>
  {#if inPreview}
    <section class="global-search-preview" aria-label="搜索结果详情">
      <div class="global-search-preview-heading"><Button variant="ghost" onclick={onBack}>← 搜索结果</Button>
        {#if onOpenContext}<Button variant="outline" onclick={onOpenContext}>打开所属会话</Button>{/if}
      </div>
      {#if previewLoading}<p role="status">正在读取内容…</p>{/if}
      {#if previewError}<p role="alert">{previewError}</p>{/if}
      {#if preview}
        <h2>{preview.title}</h2>
        {#if preview.truncated}<p role="status">内容过长，仅显示部分预览。</p>{/if}
        <pre>{@render highlighted(preview.content)}</pre>
      {/if}
    </section>
  {:else}
    <div id="global-search-results" class="global-search-results" role="listbox" aria-label="搜索结果" aria-busy={search.pending.length > 0}>
      {#each groups as group}
        <div class="global-search-group" role="group" aria-label={searchKindLabels[group.kind]}>
          <div class="global-search-group-heading"><span>{searchKindLabels[group.kind]}</span>
            {#if !parsed.kind && group.items.length > 5}<Button variant="ghost" onclick={() => onSearch(parsed.query, group.kind, search.workspaceId)}>查看全部</Button>{/if}
          </div>
          {#each (parsed.kind ? group.items : group.items.slice(0, 5)) as item (item.id)}
            <button id={`search-result-${encodeURIComponent(item.id)}`} class="global-search-result" type="button" role="option" aria-selected={activeId === item.id}
              aria-disabled={Boolean(item.disabledReason)} onclick={() => { if (!item.disabledReason) onActivate(item); }} onmouseenter={() => selectedId = item.id}>
              <span class="global-search-copy">
                <strong>{@render highlighted(item.title)}</strong>
                {#if item.description}<small>{item.description}</small>{/if}
                {#if item.excerpt}<span class="global-search-excerpt">{@render highlighted(item.excerpt)}</span>{/if}
                {#if item.disabledReason}<small>{item.disabledReason}</small>{/if}
              </span>
              {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
            </button>
          {/each}
        </div>
      {/each}
      {#if !visible.length && !search.pending.length}<p class="global-search-empty">没有匹配的结果。试试其他关键词或搜索范围。</p>{/if}
    </div>
    {#if search.hasMore}<Button variant="ghost" disabled={search.limit >= 500} onclick={() => onSearch(search.query, search.kind, search.workspaceId, Math.min(500, search.limit + 50))}>{search.limit >= 500 ? '请缩小搜索范围以查看其他结果' : '加载更多结果'}</Button>{/if}
  {/if}
  <div class="global-search-status" role="status" aria-live="polite">
    {#if search.pending.length}正在搜索…{/if}
    {#each [...search.errors, ...search.warnings] as message}<p>{message}</p>{/each}
  </div>
  <footer class="global-search-footer"><span id="global-search-keyboard">Tab / Shift+Tab 切换类型 · ↑↓ 选择 · Enter 打开 · Esc 返回</span><span>双击 Shift · ⌘/Ctrl K</span></footer>
</dialog>
