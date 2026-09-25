<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSelectProps } from '../../contract';
  let { options, value, placeholder = '请选择', disabled = false, onSelect, ...attrs }: UiSelectProps = $props();
  const uid = $props.id();
  let trigger: HTMLButtonElement;
  let popup: HTMLDivElement;
  let open = $state(false);
  let active = $state(-1);
  let anchor: DOMRect;
  let query = '';
  let typedAt = 0;
  const selected = $derived(options.find(option => option.value === value));
  function close() { if (popup?.matches(':popover-open')) popup.hidePopover(); open = false; }
  function position() {
    const rect = trigger.getBoundingClientRect();
    anchor = rect;
    const width = Math.min(Math.max(rect.width, 180), innerWidth - 16);
    popup.style.width = `${width}px`;
    const height = Math.min(popup.scrollHeight, 280, innerHeight - 16);
    popup.style.maxHeight = `${height}px`;
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, rect.bottom + height + 4 <= innerHeight - 8 ? rect.bottom + 4 : rect.top - height - 4)}px`;
  }
  function reveal() {
    if (disabled || !options.some(option => !option.disabled)) return;
    query = '';
    active = Math.max(0, options.findIndex(option => option.value === value && !option.disabled));
    if (options[active]?.disabled) active = options.findIndex(option => !option.disabled);
    popup.showPopover(); open = true; position();
    void tick().then(scrollActive);
  }
  function scrollActive() { popup?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' }); }
  function choose(index: number) {
    const option = options[index];
    if (disabled || !option || option.disabled) return;
    close(); trigger.focus(); if (option.value !== value) onSelect(option.value);
  }
  function keydown(event: KeyboardEvent) {
    if (disabled || event.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    const typingSpace = event.key === ' ' && query && Date.now() - typedAt <= 700;
    if (!typingSpace && ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { reveal(); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(active); return; }
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
      const index = enabled.indexOf(active);
      active = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)! : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      void tick().then(scrollActive);
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      if (!open) reveal();
      query = Date.now() - typedAt > 700 ? event.key : query + event.key; typedAt = Date.now();
      const match = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
      if (match >= 0) { active = match; void tick().then(scrollActive); }
    }
  }
  onMount(() => {
    const dismissOnScroll = (event: Event) => { if (!open || event.target instanceof Node && popup.contains(event.target)) return; const rect = trigger.getBoundingClientRect(); if (rect.top !== anchor.top || rect.left !== anchor.left) close(); };
    window.addEventListener('scroll', dismissOnScroll, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', dismissOnScroll, true); window.removeEventListener('resize', close); };
  });
  $effect(() => { if (disabled || !options[active] || options[active]?.disabled) close(); });
</script>

<span class="ui-select">
  <button {...attrs} bind:this={trigger} type="button" class={`ui-select-trigger ${attrs.class ?? ''}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-options`} aria-activedescendant={open && active >= 0 ? `${uid}-option-${active}` : undefined} {disabled} onclick={() => open ? close() : reveal()} onkeydown={keydown} onblur={close}>
    <span>{selected?.label ?? placeholder}</span><Icon name="chevron-down" size={14} aria-hidden="true" />
  </button>
  <div bind:this={popup} id={`${uid}-options`} class="ui-select-popup" popover="auto" role="listbox" aria-label={attrs['aria-label']} aria-labelledby={attrs['aria-labelledby']} ontoggle={(event) => { open = event.newState === 'open'; }}>
    {#each options as option, index (option.value)}
      <button type="button" role="option" id={`${uid}-option-${index}`} class="ui-select-option" class:is-active={index === active} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} disabled={option.disabled} tabindex="-1" onpointerdown={event => event.preventDefault()} onclick={event => { event.stopPropagation(); choose(index); }}>
        <span>{option.label}</span><span class="ui-select-check" aria-hidden="true">{#if option.value === value}<Icon name="check" size={14} />{/if}</span>
      </button>
    {/each}
  </div>
</span>
