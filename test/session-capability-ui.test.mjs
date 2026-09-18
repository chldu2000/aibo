import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';

test('session tree is available to any negotiated provider and disappears when capability is absent',async()=>{
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {render}=await server.ssrLoadModule('svelte/server');
    const {default:Tree}=await server.ssrLoadModule('/src/lib/components/app/PiSessionTreeOverlay.svelte');
    const {setUiKit}=await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    const props={open:true,tree:{sessionId:'s',tree:[],leafId:null},busy:false,sessionRunning:false,selectedSessionArchiving:false,navigationStatus:null,onClose(){},onRefresh(){},onSelectNode(){}};
    for(const kit of ['shadcn','material3']) {
      setUiKit(kit);
      for(const agent of ['dev.aibo.codex.agent','dev.aibo.pi.agent','external.agent']) {
        const session={id:'s',label:'Session',agent,capabilities:['session.tree']};
        assert.match(render(Tree,{props:{...props,session}}).body,/role="dialog"/);
        assert.doesNotMatch(render(Tree,{props:{...props,session:{...session,capabilities:[]}}}).body,/role="dialog"/);
      }
    }
  } finally {await server.close();}
});
