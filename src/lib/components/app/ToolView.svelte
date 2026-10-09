<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/ui-kit';
  import { t } from '$lib/i18n/runtime';
  import { connectToolFrame } from '$lib/tool-view-runtime/frame';
  import type { ToolViewHandle } from '$lib/app/tool-view-controller';
  let { title, open, request }: { title:string; open:()=>Promise<ToolViewHandle>; request:(id:string,payload:unknown)=>Promise<unknown> } = $props();
  let frame = $state<HTMLIFrameElement>();
  let handle = $state<ToolViewHandle | null>(null), error = $state(''), generation = $state(0);
  let disconnect = () => {};
  let loaded = false;
  $effect(() => {
    const version = generation; let disposed = false;
    handle = null; error = ''; loaded = false;
    // The keyed owner controls identity; parent refreshes and callback reads must
    // not become lifecycle dependencies that tear down the interactive iframe.
    void untrack(() => open()).then(value => {if (!disposed) handle=value;}).catch(value => {if (!disposed) error=String(value);});
    return () => {disposed=true;disconnect();};
  });
  function connect() {
    disconnect();
    if (loaded) { error = $t('toolView.navigation'); return; }
    loaded = true;
    if (handle) { const id = handle.id; disconnect=connectToolFrame(frame!,payload=>request(id,payload)); }
  }
  onDestroy(()=>disconnect());
</script>
<section class="tool-view" aria-label={title}>
  <div class="tool-view-recovery"><Button variant="ghost" size="sm" onclick={()=>generation++}>{$t('toolView.reload')}</Button></div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if handle}
    {#key generation}<iframe bind:this={frame} title={title} sandbox="allow-scripts" src={handle.url} referrerpolicy="no-referrer" onload={connect}></iframe>{/key}
  {/if}
</section>
<style>
  .tool-view { display:flex; flex-direction:column; height:100%; min-height:240px; min-width:0; }
  .tool-view-recovery { display:flex; justify-content:flex-end; }
  iframe { flex:1; width:100%; min-height:200px; }
</style>
