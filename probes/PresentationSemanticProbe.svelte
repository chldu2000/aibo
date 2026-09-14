<script>
  import { PresentationHost } from '$lib/ui-kit';
  import PresentationSurface from '../src/lib/workbench/PresentationSurface.svelte';
  import detail from '../fixtures/semantic-git/detail.json';
  let host;
  let themeId=$state(null);
  let active=$state(null), snapshot=$state(structuredClone(detail));
  let instance=null;
  const actions=[];
  const input={surface:'workbench',context:{workspaceId:null,sessionId:null,revision:1},data:null,theme:{}};
  export async function select(value,selectedTheme=null){
    const next=await host.prepare(value,selectedTheme,()=>{},new AbortController().signal);
    next.activate();instance?.dispose();instance=next;active=value;themeId=selectedTheme;
  }
  export function update(value){snapshot=value;}
  export function result(){return actions;}
  export function dispose(){instance?.dispose();instance=null;active=null;}
</script>
<PresentationHost bind:this={host} {active} {themeId} {input} onIntent={()=>{}} onRestore={dispose}>
  <PresentationSurface {snapshot} layout="central" onAction={action=>actions.push(action)} />
</PresentationHost>
