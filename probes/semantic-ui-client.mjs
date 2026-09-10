import '/src/app.css';
import { get } from 'svelte/store';
import { SveltePresentationAdapter } from '/src/lib/workbench/svelte-adapter.ts';
import { DomPresentationAdapter } from '/src/lib/workbench/dom-adapter.ts';
import { setUiKit, activeThemeStyle } from '/src/lib/ui-kit/registry.ts';
import collection from '/fixtures/semantic-git/collection.json';
import detail from '/fixtures/semantic-git/detail.json';
import empty from '/fixtures/semantic-git/empty.json';
import error from '/fixtures/semantic-git/error.json';
import loading from '/fixtures/semantic-git/loading.json';
import unavailable from '/fixtures/semantic-git/unavailable.json';
import partial from '/fixtures/semantic-git/partial.json';
import partialDetail from '/fixtures/semantic-git/partial-detail.json';
const fixtures={collection,detail,empty,error,loading,unavailable,partial,partialDetail};
const target=document.getElementById('probe');
let mounted;
window.semanticProbe={
  actions:[],
  async mount(renderer='svelte',kit='shadcn',layout='central',fixture='collection') {
    if(mounted)await mounted.dispose();setUiKit(kit);
    document.body.setAttribute('data-ui-kit',kit);
    document.body.style.cssText=get(activeThemeStyle)+';background:var(--background);color:var(--foreground);font-family:system-ui';
    this.actions=[];
    mounted=await (renderer==='svelte'?SveltePresentationAdapter:DomPresentationAdapter).mount(target,{snapshot:structuredClone(fixtures[fixture]),layout,focusTarget:'worktree:src/App.svelte',onAction:message=>this.actions.push(message)});
  },
  update(fixture){mounted.update(structuredClone(fixtures[fixture]));},
  async dispose(){await mounted.dispose();},
};
await window.semanticProbe.mount();

// Exercise the actual workbench composition through the same narrow port.
import { mount, unmount } from 'svelte';
import GitWorkbench from '/src/lib/workbench/GitWorkbench.svelte';
import sourcePage from '/fixtures/semantic-git/source-page.json';
let workbench;
window.semanticProbe.workbench = async function(kit='shadcn') {
  if(mounted)await mounted.dispose();if(workbench)await unmount(workbench);
  setUiKit(kit);document.body.setAttribute('data-ui-kit',kit);document.body.style.cssText=get(activeThemeStyle)+';background:var(--background);color:var(--foreground);font-family:system-ui';
  let current=structuredClone(sourcePage);
  const port={
    async open(workspaceId){current=structuredClone(sourcePage);current.context.workspaceId=workspaceId;return structuredClone(current);},
    async act(message){
      if(JSON.stringify(message.context)!==JSON.stringify(current.context))throw Error('stale_context');
      if(message.actionId==='open-diff') {const item=current.items.find(item=>item.id===message.itemId);current.detail={itemId:item.id,path:item.path,staged:item.staged,content:'--- before\n+++ after\n+semantic fixture',truncated:false};}
      else if(message.actionId==='back')current.detail=null;
      current.context.revision++;return structuredClone(current);
    },async release(){},
  };
  workbench=mount(GitWorkbench,{target,props:{workspaceId:'fixture-workspace',port,onClose:()=>{void unmount(workbench);workbench=null;}}});
};
