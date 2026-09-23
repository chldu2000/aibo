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

<style>
  .repository-select { position: relative; min-width: 0; margin: 8px 10px 10px; font-size: var(--aibo-type-meta, 12px); color: var(--repo-text); }
  button { font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .repository-trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--repo-border); border-radius: var(--repo-radius); background: var(--repo-trigger); color: inherit; text-align: left; transition: background 120ms ease, border-color 120ms ease; }
  .repository-trigger:hover:not(:disabled), .repository-trigger[aria-expanded='true'] { background: var(--repo-hover); border-color: var(--repo-outline); }
  .repository-trigger:focus-visible { outline: 2px solid var(--repo-focus); outline-offset: 2px; }
  .repository-trigger-name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; }
  .repository-total { color: var(--repo-muted); font-size: var(--aibo-type-meta, 12px); font-variant-numeric: tabular-nums; }
  .repository-chevron { display: flex; flex: none; color: var(--repo-muted); transition: transform 120ms ease; }
  .repository-chevron.is-open { transform: rotate(180deg); }
  .repository-popup { position: absolute; inset: calc(100% + 5px) 0 auto; z-index: 30; overflow: hidden; border: 1px solid var(--repo-border); border-radius: var(--repo-radius); background: var(--repo-surface); box-shadow: var(--repo-shadow); }
  .repository-search { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border-bottom: 1px solid var(--repo-border); color: var(--repo-muted); }
  .repository-search:focus-within { box-shadow: inset 0 -1px var(--repo-focus); }
  .repository-search input { width: 0; min-width: 0; flex: 1; height: 38px; margin: 0; border: 0; outline: none; padding: 0; border-radius: 0; background: transparent; color: var(--repo-text); font: inherit; box-shadow: none; }
  .repository-search input::placeholder { color: var(--repo-muted); }
  kbd { flex: none; border: 1px solid var(--repo-border); border-radius: 3px; padding: 0 3px; font: inherit; font-size: var(--aibo-type-meta, 12px); line-height: 16px; }
  .repository-options { max-height: min(280px, 45vh); overflow-y: auto; overscroll-behavior: contain; padding: 4px; scrollbar-width: thin; }
  .repository-option { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 38px; border: 0; border-radius: calc(var(--repo-radius) - 3px); padding: 8px; background: transparent; color: var(--repo-muted); text-align: left; }
  .repository-option.is-active, .repository-option:hover:not(:disabled) { background: var(--repo-hover); }
  .repository-option[aria-selected='true'] { color: var(--repo-text); }
  .repository-option-copy { display: grid; gap: 3px; flex: 1; min-width: 0; }
  .repository-option-name { color: var(--repo-text); font-weight: 500; line-height: 16px; }
  .repository-option-copy > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .repository-option-copy small { font-size: var(--aibo-type-meta, 12px); line-height: 14px; color: var(--repo-muted); }
  .repository-check { display: flex; flex: none; width: 14px; color: var(--repo-focus); }
  .all-repositories { margin-bottom: 4px; }
  .repository-empty { margin: 0; padding: 22px 12px; color: var(--repo-muted); font-size: var(--aibo-type-meta, 12px); text-align: center; }
  @media (prefers-reduced-motion: reduce) { .repository-trigger, .repository-chevron { transition: none; } }
</style>
