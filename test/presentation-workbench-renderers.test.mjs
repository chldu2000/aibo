import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {navigationActions} from '../src/lib/presentation-runtime/navigation.ts';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
const fixture=async name=>JSON.parse(await readFile(`fixtures/presentation-workbench/${name}.json`,'utf8'));
test('packed workbench renderers run outside repo and expose only host-issued action tokens',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'aibo-workbench-renderer-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination',root,'--cache',path.join(root,'cache')],{cwd:path.resolve('packages/presentation-workbench'),encoding:'utf8'}))[0];
 execFileSync('tar',['-xzf',path.join(root,packed.filename),'-C',root]);
 for(const name of ['navigation','conversation']){
  const module=await import(pathToFileURL(path.join(root,'package',name+'.js')));
  const render=module[name==='navigation'?'renderNavigation':'renderConversation'];
  const state=await fixture(name);
  const project=name==='navigation'?navigationActions:createConversationDirectory().project;
  for(const input of [state,{...state,busy:true},{...state,running:true},{...state,timelineVisibleCount:0}]) {
   const actions=project(input),nodes=flatten(render(input,actions));
   assert.equal(new Set(nodes.map(node=>node.key)).size,nodes.length,'keys remain unique');
   for(const node of nodes)for(const [event,token] of Object.entries(node.events??{}))assert.ok(actions.some(action=>action.token===token&&action.event===event),'renderer cannot invent authority');
  }
  const nodes=flatten(render(state,project(state)));
  if(name==='conversation'){
   assert.ok(nodes.some(node=>node.text==='complete'));
   assert.ok(nodes.some(node=>node.attrs?.value==='draft'));
   assert.ok(nodes.some(node=>node.attrs?.value==='Yes'));
   assert.ok(nodes.some(node=>node.text==='Earlier message'));
   assert.ok(!flatten(render({...state,timelineVisibleCount:0},project(state))).some(node=>node.text==='complete'));
  }else {
   assert.ok(nodes.some(node=>node.text==='A'));
   assert.ok(nodes.some(node=>node.text==='B'));
   assert.ok(nodes.some(node=>node.attrs?.value==='New'));
  }
 }
});
