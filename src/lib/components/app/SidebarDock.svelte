<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { Button, Icon, Input, Separator } from '$lib/ui-kit';
  import type { UiIconName } from '$lib/ui-kit';
  import { t } from '$lib/i18n/runtime';
  import { sidebarTabId } from '$lib/app/sidebar-layout';
  import type { SidebarLayout, SidebarOperation, SidebarPane, SidebarTarget } from '$lib/app/sidebar-layout';
  let { layout, titles, entries, context, collapsed = false, onCollapsedChange, onOperation, children }: {
    layout: SidebarLayout; titles: Record<string, string>; entries: {label:string;value:string;disabled?:boolean}[];
    context: string; collapsed?: boolean; onCollapsedChange: (collapsed: boolean) => void;
    onOperation: (operation: SidebarOperation) => void; children: Snippet<[string]>;
  } = $props();
  let viewportWidth = $state(1400), viewportHeight = $state(900);
  const prefix = $props.id();
  const mime = 'application/x-aibo-sidebar-tab';
  const tabElement = (id: string) => `${prefix}-tool-${encodeURIComponent(id)}`;
  const owner = (id: string) => layout.panes.find(pane => pane.tabs.includes(id));
  const icon = (id: string): UiIconName => id === 'git' ? 'branch' : id === 'context' ? 'diagnostics' : 'plugins';
  let menu: HTMLDivElement;
  let picker: HTMLDivElement;
  let menuTab = $state<string | null>(null);
  let menuPosition = $state({ left: 0, top: 0 });
  let search = $state('');
  let dragOver = $state<string | null>(null);
  let returnFocus: HTMLElement | null = null;
  const menuPane = $derived(menuTab ? owner(menuTab) : undefined);
  const filteredEntries = $derived(entries.filter(entry => entry.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())));

  $effect(() => {
    // Menus and in-progress gestures cannot cross session boundaries.
    void context;
    menu?.hidePopover(); picker?.hidePopover();
    menuTab = null; dragOver = null; pointer = null;
  });
  function position(trigger: HTMLElement) {
    const bounds = trigger.getBoundingClientRect();
    returnFocus = trigger;
    menuPosition = { left: Math.max(8, Math.min(bounds.right - 248, viewportWidth - 256)), top: Math.max(8, Math.min(bounds.bottom + 4, viewportHeight - 380)) };
  }
  async function showMenu(event: MouseEvent | KeyboardEvent, id: string) {
    event.preventDefault();
    picker?.hidePopover();
    position(event.currentTarget as HTMLElement); menuTab = id;
    const scope = context;
    // Some WebViews dispatch contextmenu before pointerup; wait until native light-dismiss has finished.
    if (event instanceof MouseEvent && event.type === 'contextmenu' && event.buttons !== 0) {
      await new Promise<void>(resolve => window.addEventListener('pointerup', () => setTimeout(resolve, 0), {once:true}));
    }
    await tick();
    if (scope === context && menu.isConnected && owner(id)) menu.showPopover();
  }
  function menuToggle(event: ToggleEvent) {
    if (event.newState === 'open') (event.currentTarget as HTMLElement).querySelector<HTMLElement>('input, button:not(:disabled)')?.focus();
  }
  function closeMenu() {
    menu.hidePopover();
    if (returnFocus?.getClientRects().length) returnFocus.focus();
    else if (menuTab) document.getElementById(tabElement(menuTab))?.focus();
  }
  async function act(operation: SidebarOperation) {
    closeMenu();
    onOperation(operation);
    if (['focus', 'split', 'dock', 'move'].includes(operation.kind)) onCollapsedChange(false);
    await tick();
    if ('tabId' in operation) {
      const id = layout.tabs.some(tab => tab.id === operation.tabId) ? operation.tabId : layout.tabs[0]?.id;
      if (id) document.getElementById(tabElement(id))?.focus();
      else document.getElementById(`${prefix}-add`)?.focus();
    }
  }
  function focus(id: string) {
    onOperation({kind:'focus',tabId:id}); onCollapsedChange(false);
  }
  function reorder(id: string, delta: number) {
    const index = layout.tabs.findIndex(tab => tab.id === id);
    if (index + delta < 0 || index + delta >= layout.tabs.length) return;
    onOperation({kind:'reorder',tabId:id,before:layout.tabs[index + (delta < 0 ? -1 : 2)]?.id});
  }
  async function navigate(event: KeyboardEvent, id: string) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { await showMenu(event,id); return; }
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (event.altKey && delta) { event.preventDefault(); reorder(id,delta); return; }
    const index = layout.tabs.findIndex(tab => tab.id === id);
    const next = event.key === 'Home' ? layout.tabs[0] : event.key === 'End' ? layout.tabs.at(-1)
      : delta ? layout.tabs[(index + delta + layout.tabs.length) % layout.tabs.length] : null;
    if (next) { event.preventDefault(); document.getElementById(tabElement(next.id))?.focus(); }
  }
  function menuKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }
  function drag(event: DragEvent, id: string) {
    event.dataTransfer?.setData(mime,JSON.stringify({context,id}));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function drop(event: DragEvent, before: string) {
    event.preventDefault(); dragOver = null;
    try {
      const value = JSON.parse(event.dataTransfer?.getData(mime) ?? '');
      if (value.context === context && layout.tabs.some(tab => tab.id === value.id)) onOperation({kind:'reorder',tabId:value.id,before});
    } catch { /* Ignore unrelated drags. */ }
  }
  function add(entry: {value:string}) {
    picker.hidePopover();
    const target = JSON.parse(entry.value) as SidebarTarget;
    onOperation({kind:'open',target}); onCollapsedChange(false);
    void tick().then(() => document.getElementById(tabElement(sidebarTabId(target)))?.focus());
  }
  let pointer: {id:number;pane:SidebarPane;x:number;y:number;resize:boolean;context:string} | null = null;
  function begin(event: PointerEvent, pane: SidebarPane, resize: boolean) {
    if (event.button !== 0) return;
    event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (pane.active) onOperation({kind:'focus',tabId:pane.active});
    pointer = {id:event.pointerId,pane:{...pane,x:Math.min(pane.x,Math.max(0,viewportWidth-Math.min(pane.width,viewportWidth))),y:Math.min(pane.y,Math.max(0,viewportHeight-Math.min(pane.height,viewportHeight-60)))},x:event.clientX,y:event.clientY,resize,context};
  }
  function move(event: PointerEvent) {
    if (!pointer || pointer.id !== event.pointerId || pointer.context !== context) return;
    const {pane,x,y,resize} = pointer, dx = event.clientX-x, dy=event.clientY-y;
    onOperation({kind:'bounds',paneId:pane.id,x:resize?pane.x:Math.min(viewportWidth-100,pane.x+dx),y:resize?pane.y:Math.min(viewportHeight-60,pane.y+dy),width:resize?pane.width+dx:pane.width,height:resize?pane.height+dy:pane.height});
  }
  function nudge(event: KeyboardEvent, pane: SidebarPane, resize: boolean) {
    const dx = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0;
    const dy = event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0;
    if (!dx && !dy) return; event.preventDefault();
    onOperation({kind:'bounds',paneId:pane.id,x:pane.x+(resize?0:dx),y:pane.y+(resize?0:dy),width:pane.width+(resize?dx:0),height:pane.height+(resize?dy:0)});
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight}/>
<section class="sidebar-dock" class:collapsed aria-label={$t('sidebar.title')}>
  <div class="sidebar-dock-panes">
    {#each layout.panes as pane (pane.id)}
      <section class="sidebar-dock-pane" class:floating={pane.floating} class:active={pane.id===layout.activePane}
        hidden={collapsed && !pane.floating || !pane.tabs.length && layout.panes.some(other => !other.floating && other.tabs.length > 0)}
        aria-label={pane.active ? titles[pane.active] : $t('sidebar.title')}
        style:z-index={pane.floating?(pane.id===layout.activePane?36:35):undefined}
        style:left={pane.floating?`${Math.min(pane.x,Math.max(0,viewportWidth-Math.min(pane.width,viewportWidth)))}px`:undefined}
        style:top={pane.floating?`${Math.min(pane.y,Math.max(0,viewportHeight-Math.min(pane.height,viewportHeight-60)))}px`:undefined}
        style:width={pane.floating?`${Math.min(pane.width,viewportWidth)}px`:undefined}
        style:height={pane.floating?`${Math.min(pane.height,viewportHeight-60)}px`:undefined}>
        <header class="sidebar-dock-header">
          {#if pane.active}
            <Icon name={icon(pane.active)} size={18}/>
            <span class="sidebar-dock-title" title={titles[pane.active]}>{titles[pane.active]}</span>
            {#if pane.floating}
              <Button variant="ghost" size="icon" aria-label={$t('sidebar.move')} title={$t('sidebar.move')} onpointerdown={(event:PointerEvent)=>begin(event,pane,false)} onpointermove={move} onpointerup={()=>pointer=null} onpointercancel={()=>pointer=null} onkeydown={(event:KeyboardEvent)=>nudge(event,pane,false)}><Icon name="focus" size={16}/></Button>
              <Button variant="ghost" size="icon" aria-label={$t('sidebar.dock')} title={$t('sidebar.dock')} onclick={()=>onOperation({kind:'dock',tabId:pane.active!})}><Icon name="panel-right" size={16}/></Button>
            {/if}
            <Button variant="ghost" size="icon" aria-label={$t('sidebar.moreActions',{name:titles[pane.active]})} title={$t('sidebar.moreActions',{name:titles[pane.active]})} aria-haspopup="true" onclick={(event:MouseEvent)=>showMenu(event,pane.active!)}><Icon name="more" size={18}/></Button>
          {:else}<span class="sidebar-dock-title">{$t('sidebar.title')}</span>{/if}
        </header>
        {#each pane.tabs as id (id)}
          <div class="sidebar-dock-content" id={`${prefix}-content-${encodeURIComponent(id)}`} role="region" aria-label={titles[id]??id} hidden={id!==pane.active}>
            {@render children(id)}
          </div>
        {/each}
        {#if !pane.tabs.length}<p class="sidebar-dock-empty">{$t('sidebar.viewsEmpty')}</p>{/if}
        {#if pane.floating}<Button class="sidebar-dock-resize" variant="ghost" size="sm" aria-label={$t('sidebar.resize')} onpointerdown={(event:PointerEvent)=>begin(event,pane,true)} onpointermove={move} onpointerup={()=>pointer=null} onpointercancel={()=>pointer=null} onkeydown={(event:KeyboardEvent)=>nudge(event,pane,true)}>↘</Button>{/if}
      </section>
    {/each}
  </div>
  <nav class="sidebar-tool-rail" aria-label={$t('sidebar.rail')}>
    <div class="sidebar-tool-list">
      {#each layout.tabs as tab (tab.id)}
        {@const pane = owner(tab.id)}
        <div class="sidebar-tool-row" class:drop-before={dragOver===tab.id}>
          <Button id={tabElement(tab.id)} class="sidebar-tool" variant="ghost" aria-label={titles[tab.id]??tab.id} title={titles[tab.id]??tab.id}
            aria-pressed={pane?.active===tab.id && pane?.id===layout.activePane} aria-controls={`${prefix}-content-${encodeURIComponent(tab.id)}`}
            draggable="true" ondragstart={(event:DragEvent)=>drag(event,tab.id)} ondragend={()=>dragOver=null}
            ondragover={(event:DragEvent)=>{event.preventDefault();dragOver=tab.id;}} ondragleave={()=>dragOver=null} ondrop={(event:DragEvent)=>drop(event,tab.id)}
            onkeydown={(event:KeyboardEvent)=>navigate(event,tab.id)} oncontextmenu={(event:MouseEvent)=>showMenu(event,tab.id)} onclick={()=>focus(tab.id)}>
            <span class="sidebar-tool-icon"><Icon name={icon(tab.id)} size={20}/>{#if pane?.active===tab.id}<span class="sidebar-tool-visible" aria-hidden="true"></span>{/if}</span>
            <span class="sidebar-tool-label">{titles[tab.id]??tab.id}</span>
          </Button>
          <Button class="sidebar-tool-more" variant="ghost" size="icon" aria-label={$t('sidebar.moreActions',{name:titles[tab.id]??tab.id})} aria-haspopup="true" onclick={(event:MouseEvent)=>showMenu(event,tab.id)}><Icon name="more" size={16}/></Button>
        </div>
      {/each}
      <Button id={`${prefix}-add`} class="sidebar-tool" variant="ghost" aria-label={$t('sidebar.addView')} title={$t('sidebar.addView')} popovertarget={`${prefix}-picker`} onclick={(event:MouseEvent)=>{position(event.currentTarget as HTMLElement); search='';}}>
        <span class="sidebar-tool-icon"><Icon name="add" size={20}/></span><span class="sidebar-tool-label">{$t('sidebar.addView')}</span>
      </Button>
    </div>
    <Button class="sidebar-tool sidebar-tool-collapse" variant="ghost" aria-label={$t(collapsed?'sidebar.expandViews':'sidebar.collapseViews')} title={$t(collapsed?'sidebar.expandViews':'sidebar.collapseViews')} onclick={()=>onCollapsedChange(!collapsed)}>
      <span class="sidebar-tool-icon"><Icon name="panel-right" size={20}/></span><span class="sidebar-tool-label">{$t(collapsed?'sidebar.expandViews':'sidebar.collapseViews')}</span>
    </Button>
  </nav>
</section>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Arrow keys supplement the native button and popover keyboard behavior.) -->
<div bind:this={menu} class="sidebar-view-menu" popover="auto" role="group" aria-label={menuTab ? titles[menuTab] : $t('sidebar.rail')} ontoggle={menuToggle} onkeydown={menuKeys} style:left={`${menuPosition.left}px`} style:top={`${menuPosition.top}px`}>
  {#if menuTab && menuPane}
    <div class="sidebar-menu-title">{titles[menuTab]}</div>
    <Button variant="ghost" onclick={()=>act({kind:'focus',tabId:menuTab!})}><Icon name="eye" size={16}/>{$t('sidebar.openView')}</Button>
    <Button variant="ghost" disabled={!menuPane.floating&&menuPane.tabs.length<2} onclick={()=>act({kind:'split',tabId:menuTab!})}><Icon name="panel-right" size={16}/>{$t('sidebar.openBelow')}</Button>
    <Button variant="ghost" onclick={()=>act({kind:menuPane!.floating?'dock':'float',tabId:menuTab!})}><Icon name="window-maximize" size={16}/>{$t(menuPane.floating?'sidebar.dock':'sidebar.float')}</Button>
    {#if menuPane.id!=='main' && !menuPane.floating}<Button variant="ghost" onclick={()=>act({kind:'dock',tabId:menuTab!})}><Icon name="panel-right" size={16}/>{$t('sidebar.returnMain')}</Button>{/if}
    <Separator/>
    <Button variant="ghost" disabled={layout.tabs[0]?.id===menuTab} onclick={()=>{closeMenu();reorder(menuTab!,-1);}}>{$t('sidebar.moveUp')}</Button>
    <Button variant="ghost" disabled={layout.tabs.at(-1)?.id===menuTab} onclick={()=>{closeMenu();reorder(menuTab!,1);}}>{$t('sidebar.moveDown')}</Button>
    <Separator/>
    <Button variant="ghost" onclick={()=>act({kind:'close',tabId:menuTab!})}><Icon name="close" size={16}/>{$t('sidebar.removeView')}</Button>
  {/if}
</div>
<div bind:this={picker} id={`${prefix}-picker`} class="sidebar-view-menu sidebar-view-picker" popover="auto" role="group" aria-label={$t('sidebar.addView')} ontoggle={menuToggle} style:left={`${menuPosition.left}px`} style:top={`${menuPosition.top}px`}>
  <Input aria-label={$t('sidebar.searchViews')} placeholder={$t('sidebar.searchViews')} bind:value={search}/>
  <div class="sidebar-picker-results">
    {#each filteredEntries as entry}
      {@const id = sidebarTabId(JSON.parse(entry.value) as SidebarTarget)}
      <Button variant="ghost" disabled={entry.disabled} onclick={()=>add(entry)}><Icon name={icon(id)} size={18}/><span>{entry.label}</span>{#if layout.tabs.some(tab=>tab.id===id)}<Icon name="check" size={16}/>{/if}</Button>
    {:else}<p class="sidebar-dock-empty">{$t('sidebar.noViews')}</p>{/each}
  </div>
</div>
