<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiRepositorySelectProps } from '../../contract';
  let { repositories, selectedId, open, search, disabled, onOpenChange, onSearch, onSelect }: UiRepositorySelectProps = $props();
  const uid = $props.id();
  let root: HTMLDivElement;
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let active = $state(0);
  const selected = $derived(repositories.find(repo => repo.id === selectedId));
  const query = $derived(search.trim().toLocaleLowerCase());
  const matches = $derived(repositories.filter(repo => `${repo.name} ${repo.relativePath}`.toLocaleLowerCase().includes(query)));
  const options = $derived([
    ...(!query || '所有仓库'.includes(query) ? [{ id: null, name: '所有仓库', relativePath: `${repositories.length} 个仓库` }] : []),
    ...matches,
  ]);
  const activeIndex = $derived(Math.min(active, options.length - 1));
  const description = (name: string, path: string) => path !== name && path !== '.' ? path : '';

  $effect(() => {
    if (!open) return;
    untrack(() => {
      active = Math.max(0, options.findIndex(option => option.id === selectedId));
      // The popup can also be opened by the history tab.
      void tick().then(() => { if (open) input?.focus(); });
    });
  });
  function dismiss(restoreFocus = false) {
    onOpenChange(false);
    if (restoreFocus) void tick().then(() => document.querySelector<HTMLButtonElement>('[data-repository-select-trigger]')?.focus());
  }
  function choose(id: string | null) {
    if (disabled) return;
    onSelect(id);
    dismiss(true);
  }
  function outside(event: PointerEvent | FocusEvent) {
    if (open && event.target instanceof Node && !root?.contains(event.target)) dismiss();
  }
  function keydown(event: KeyboardEvent) {
    if (!root?.contains(document.activeElement)) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); dismiss(true); }
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !disabled) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { onOpenChange(true); return; }
      if (!options.length) return;
      active = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      void tick().then(() => list?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' && open && document.activeElement === input) {
      event.preventDefault(); if (options[activeIndex]) choose(options[activeIndex].id);
    }
  }
  onMount(() => {
    const element = root;
    element.addEventListener('keydown', keydown);
    return () => element.removeEventListener('keydown', keydown);
  });
</script>

<svelte:window onpointerdown={outside} onfocusin={outside} />
<div class="repository-select" bind:this={root}>
  <button class="repository-trigger" type="button" data-repository-select-trigger aria-label="选择仓库" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} {disabled} onclick={() => onOpenChange(!open)} title={selected ? `${selected.name} · ${selected.relativePath}` : '查看工作区中的所有仓库'}>
    <Icon name="folder" size={14} aria-hidden="true" />
    <span class="repository-trigger-name">{selected?.name ?? '所有仓库'}</span>
    {#if !selected}<span class="repository-total">{repositories.length}</span>{/if}
    <span class="repository-chevron" class:is-open={open}><Icon name="chevron-down" size={13} aria-hidden="true" /></span>
  </button>
  {#if open}
    <div class="repository-popup">
      <div class="repository-search">
        <Icon name="search" size={14} aria-hidden="true" />
        <input bind:this={input} role="combobox" aria-label="搜索仓库" aria-expanded="true" aria-autocomplete="list" aria-controls={`${uid}-list`} aria-activedescendant={activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined} placeholder="搜索仓库…" value={search} {disabled} autocomplete="off" spellcheck="false" oninput={(event) => { active = 0; onSearch(event.currentTarget.value); }} />
        <kbd aria-hidden="true">Esc</kbd>
      </div>
      <div class="repository-options" id={`${uid}-list`} role="listbox" aria-label="工作区仓库" bind:this={list}>
        {#each options as option, index (option.id)}
          {@const detail = description(option.name, option.relativePath)}
          <button type="button" role="option" id={`${uid}-option-${index}`} aria-label={detail ? `${option.name}，${detail}` : option.name} aria-selected={option.id === selectedId} tabindex="-1" class="repository-option" class:is-active={index === activeIndex} class:all-repositories={option.id === null} {disabled} title={option.relativePath} onclick={() => choose(option.id)}>
            <Icon name={option.id === null ? 'plugins' : 'folder'} size={14} aria-hidden="true" />
            <span class="repository-option-copy"><span class="repository-option-name">{option.name}</span>{#if detail}<small>{detail}</small>{/if}</span>
            <span class="repository-check">{#if option.id === selectedId}<Icon name="check" size={14} aria-hidden="true" />{/if}</span>
          </button>
        {/each}
      </div>
      {#if options.length === 0}<p class="repository-empty" role="status">没有匹配的仓库</p>{/if}
    </div>
  {/if}
</div>
