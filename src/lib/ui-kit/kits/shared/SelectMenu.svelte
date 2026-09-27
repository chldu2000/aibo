<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSelectMenuProps } from '../../contract';
  import { createTypeahead, stepEnabledOption } from './select-navigation';
  /** A host-drawn listbox for a trigger the host does not render, such as one inside an isolated frame. */
  let { anchor, options, value, label, onSelect, onClose }: UiSelectMenuProps = $props();
  const uid = $props.id();
  let popup: HTMLDivElement;
  let closed = false;
  const typeahead = createTypeahead();
  const initial = () => {
    const index = options.findIndex(option => option.value === value && !option.disabled);
    return index >= 0 ? index : options.findIndex(option => !option.disabled);
  };
  let active = $state(initial());

  function close() {
    if (closed) return;
    closed = true;
    if (popup?.matches(':popover-open')) popup.hidePopover();
    onClose();
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onSelect(option.value);
    close();
  }
  function scrollActive() { popup?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' }); }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!typeahead.continues(event.key) && ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ') { choose(active); return; }
      active = stepEnabledOption(options, active, event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End');
      void tick().then(scrollActive);
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const match = typeahead.match(options, event.key);
      if (match >= 0) { active = match; void tick().then(scrollActive); }
    }
  }
  onMount(() => {
    popup.showPopover();
    const width = Math.min(Math.max(anchor.width, 180), innerWidth - 16);
    const height = Math.min(popup.scrollHeight, 280, innerHeight - 16);
    Object.assign(popup.style, {
      width: `${width}px`, maxHeight: `${height}px`,
      left: `${Math.max(8, Math.min(anchor.left, innerWidth - width - 8))}px`,
      top: `${Math.max(8, anchor.bottom + height + 4 <= innerHeight - 8 ? anchor.bottom + 4 : anchor.top - height - 4)}px`,
    });
    popup.focus();
    void tick().then(scrollActive);
    // The anchor cannot follow a scrolled or resized layout, so the menu closes instead of drifting.
    const dismiss = (event: Event) => { if (!(event.target instanceof Node && popup.contains(event.target))) close(); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', close); };
  });
  $effect(() => { if (!options.some(option => !option.disabled)) close(); });
</script>

<div bind:this={popup} id={`${uid}-options`} class="ui-select-popup" popover="auto" role="listbox" tabindex="-1" aria-label={label}
  aria-activedescendant={active >= 0 ? `${uid}-option-${active}` : undefined}
  onkeydown={keydown} onfocusout={event => { if (!(event.relatedTarget instanceof Node && popup.contains(event.relatedTarget))) close(); }}
  ontoggle={event => { if (event.newState === 'closed') close(); }}>
  {#each options as option, index (option.value)}
    <button type="button" role="option" id={`${uid}-option-${index}`} class="ui-select-option" class:is-active={index === active} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} disabled={option.disabled} tabindex="-1" onpointerdown={event => event.preventDefault()} onclick={event => { event.stopPropagation(); choose(index); }}>
      <span>{option.label}</span><span class="ui-select-check" aria-hidden="true">{#if option.value === value}<Icon name="check" size={14} />{/if}</span>
    </button>
  {/each}
</div>
