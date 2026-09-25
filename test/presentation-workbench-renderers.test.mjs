import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink,realpath} from 'node:fs/promises';
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
 const metadata=JSON.parse(await readFile(path.join(root,'package/package.json'),'utf8'));
 await mkdir(path.join(root,'node_modules'));
 for(const dependency of Object.keys(metadata.dependencies ?? {})) await symlink(await realpath(path.resolve('node_modules',dependency)),path.join(root,'node_modules',dependency),'dir');
 for(const name of ['git','inspector','capability'])assert.equal(typeof (await import(pathToFileURL(path.join(root,'package',name+'.js'))))['render'+name[0].toUpperCase()+name.slice(1)],'function');
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

test('Git and Inspector render bound write targets, errors, full output and disabled permissions',async()=>{
 const {renderGit}=await import('../packages/presentation-workbench/git.js');
 const {renderInspector}=await import('../packages/presentation-workbench/inspector.js');
 const {createGitDirectory}=await import('../src/lib/presentation-runtime/git.ts');
 const {createInspectorDirectory}=await import('../src/lib/presentation-runtime/inspector.ts');
 for(const [name,render,create] of [['git',renderGit,createGitDirectory],['inspector',renderInspector,createInspectorDirectory]]){
  const state=await fixture(name),directory=create();
  const variants=[state,{...state,workspace:{...state.workspace,trust:'untrusted'}},{...state,busy:true,operationBusy:true}];
  if(name==='git')variants.push({...state,draft:{...state.draft,gitSection:'changes'}});
  for(const value of variants){
   const actions=directory.project(value),nodes=flatten(render(value,actions));
   assert.equal(new Set(nodes.map(node=>node.key)).size,nodes.length);
   for(const node of nodes)for(const [event,token] of Object.entries(node.events??{}))assert.ok(actions.some(action=>action.token===token&&action.event===event));
   assert.ok(nodes.some(node=>node.text===(name==='git'?'Full Git diff':'Full artifact')));
   assert.ok(nodes.some(node=>node.text===(name==='git'?'差异已截断':'产物已截断')));
   if(name==='inspector')for(const output of ['Test output','Verification output','Build output','Full diff'])assert.ok(nodes.some(node=>node.text===output));
  }
 }
});

test('capability renderer passes exact host semantic identity to the chosen skin renderer',async()=>{
 const {renderCapability}=await import('../packages/presentation-workbench/capability.js');
 const {createCapabilityWorkbenchDirectory}=await import('../src/lib/presentation-runtime/capability-workbench.ts');
 const state=await fixture('capability'),actions=createCapabilityWorkbenchDirectory().project(state);let received;
 const tree=renderCapability(state,actions,input=>{received=input;return {tag:'pre',key:'semantic:content',text:input.snapshot.view.content}});
 assert.equal(received.snapshot,state.view.snapshot);
 for(const action of received.actions){const entry=actions.find(entry=>entry.token===action.token);assert.deepEqual(action.action,JSON.parse(entry.args[0]));}
 assert.ok(flatten(tree).some(node=>node.text===state.view.snapshot.view.content));
});
