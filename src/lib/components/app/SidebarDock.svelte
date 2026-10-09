<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { Button, Icon, Select } from '$lib/ui-kit';
  import { t } from '$lib/i18n/runtime';
  import type { SidebarLayout, SidebarOperation, SidebarPane, SidebarTarget } from '$lib/app/sidebar-layout';
  let { layout, titles, entries, context, onOperation, children }: {
    layout: SidebarLayout; titles: Record<string, string>; entries: {label:string;value:string;disabled?:boolean}[];
    context: string; onOperation: (operation: SidebarOperation) => void; children: Snippet<[string]>;
  } = $props();
  let viewportWidth = $state(1400), viewportHeight = $state(900);
  const mime = 'application/x-aibo-sidebar-tab';
  let dragging = $state<string | null>(null);
  function drag(event: DragEvent, id: string) {
    dragging = id;
    event.dataTransfer?.setData(mime, JSON.stringify({context,id}));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function drop(event: DragEvent, paneId: string, before?: string) {
    event.preventDefault(); event.stopPropagation();
    try {
      const value = JSON.parse(event.dataTransfer?.getData(mime) ?? '');
      if (value.context === context && layout.tabs.some(tab => tab.id === value.id)) onOperation({kind:'move',tabId:value.id,paneId,before});
    } catch { /* Ignore unrelated drags. */ }
    dragging = null;
  }
  function splitDrop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation();
    try {
      const value = JSON.parse(event.dataTransfer?.getData(mime) ?? '');
      if (value.context === context && layout.tabs.some(tab => tab.id === value.id)) onOperation({kind:'split',tabId:value.id});
    } catch { /* Ignore unrelated drags. */ }
    dragging = null;
  }
  async function navigate(event: KeyboardEvent, pane: SidebarPane) {
    const index = pane.tabs.indexOf(pane.active ?? '');
    const next = event.key === 'ArrowRight' ? pane.tabs[(index+1)%pane.tabs.length]
      : event.key === 'ArrowLeft' ? pane.tabs[(index-1+pane.tabs.length)%pane.tabs.length]
      : event.key === 'Home' ? pane.tabs[0] : event.key === 'End' ? pane.tabs.at(-1) : null;
    if (event.key === 'Delete' && pane.active) { event.preventDefault(); onOperation({kind:'close',tabId:pane.active}); }
    else if (next) { event.preventDefault(); onOperation({kind:'focus',tabId:next}); }
    else return;
    await tick();
    const active = layout.panes.find(value => value.id === pane.id)?.active;
    if (active) document.getElementById(tabElement(active))?.focus();
  }
  const tabElement = (id: string) => `sidebar-tab-${encodeURIComponent(id)}`;
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
<section class="sidebar-dock" aria-label={$t('sidebar.title')}>
  {#each layout.panes as pane (pane.id)}
    <section class="sidebar-dock-pane" class:floating={pane.floating} aria-label={$t('sidebar.title')}
      style:z-index={pane.floating?(pane.id===layout.activePane?36:35):undefined}
      style:left={pane.floating?`${Math.min(pane.x,Math.max(0,viewportWidth-Math.min(pane.width,viewportWidth)))}px`:undefined}
      style:top={pane.floating?`${Math.min(pane.y,Math.max(0,viewportHeight-Math.min(pane.height,viewportHeight-60)))}px`:undefined}
      style:width={pane.floating?`${Math.min(pane.width,viewportWidth)}px`:undefined}
      style:height={pane.floating?`${Math.min(pane.height,viewportHeight-60)}px`:undefined}>
      <div class="sidebar-dock-toolbar">
        {#if pane.floating}<Button variant="ghost" size="sm" aria-label={$t('sidebar.move')} onpointerdown={(event:PointerEvent)=>begin(event,pane,false)} onpointermove={move} onpointerup={()=>pointer=null} onpointercancel={()=>pointer=null} onkeydown={(event:KeyboardEvent)=>nudge(event,pane,false)}>{$t('sidebar.move')}</Button>{/if}
        <Select aria-label={$t('sidebar.add')} placeholder={$t('sidebar.add')} value="" options={entries} onSelect={(value:string)=>onOperation({kind:'open',target:JSON.parse(value) as SidebarTarget,paneId:pane.id})}/>
        {#if pane.active}
          <Button variant="ghost" size="sm" disabled={!pane.floating&&pane.tabs.length<2} onclick={()=>onOperation({kind:'split',tabId:pane.active!})}>{$t('sidebar.split')}</Button>
          <Button variant="ghost" size="sm" onclick={()=>onOperation({kind:pane.floating?'dock':'float',tabId:pane.active!})}>{$t(pane.floating?'sidebar.dock':'sidebar.float')}</Button>
        {/if}
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Drop targets mirror the keyboard pane actions.) -->
      <div class="sidebar-dock-tabs" role="tablist" tabindex="-1" aria-label={$t('side.views')} ondragover={(event)=>event.preventDefault()} ondrop={(event)=>drop(event,pane.id)}>
        {#each pane.tabs as id (id)}
          <div class="sidebar-dock-tab" class:selected={id===pane.active}>
            <Button id={tabElement(id)} variant="ghost" size="sm" role="tab" aria-selected={id===pane.active} aria-controls={`sidebar-content-${encodeURIComponent(id)}`} tabindex={id===pane.active?0:-1}
              draggable="true" ondragstart={(event:DragEvent)=>drag(event,id)} ondragend={()=>dragging=null} ondragover={(event:DragEvent)=>event.preventDefault()} ondrop={(event:DragEvent)=>drop(event,pane.id,id)} onkeydown={(event:KeyboardEvent)=>navigate(event,pane)} onclick={()=>onOperation({kind:'focus',tabId:id})}>{titles[id]??id}</Button>
            <Button variant="ghost" size="icon" aria-label={$t('sidebar.close',{title:titles[id]??id})} onclick={()=>onOperation({kind:'close',tabId:id})}><Icon name="close" size={12}/></Button>
          </div>
        {/each}
      </div>
      {#each pane.tabs as id (id)}
        <div class="sidebar-dock-content" id={`sidebar-content-${encodeURIComponent(id)}`} role="tabpanel" aria-labelledby={tabElement(id)} hidden={id!==pane.active}>
          {@render children(id)}
        </div>
      {/each}
      {#if !pane.tabs.length}<p>{$t('sidebar.empty')}</p>{/if}
      {#if dragging}<Button variant="outline" ondragover={(event:DragEvent)=>event.preventDefault()} ondrop={splitDrop} onclick={()=>{if(dragging)onOperation({kind:'split',tabId:dragging});dragging=null;}}>{$t('sidebar.split')}</Button>{/if}
      {#if pane.floating}<Button class="sidebar-dock-resize" variant="ghost" size="sm" aria-label={$t('sidebar.resize')} onpointerdown={(event:PointerEvent)=>begin(event,pane,true)} onpointermove={move} onpointerup={()=>pointer=null} onpointercancel={()=>pointer=null} onkeydown={(event:KeyboardEvent)=>nudge(event,pane,true)}>↘</Button>{/if}
    </section>
  {/each}
</section>
