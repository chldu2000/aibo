import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolViewController} from '../src/lib/app/tool-view-controller.ts';
import {createSidebarController} from '../src/lib/app/sidebar-controller.ts';
import {createViewStateStore} from '../src/lib/app/view-state-storage.ts';
const target={installationId:'installation',contributionId:'example.tool'};
test('mount changes reuse a backend; workspaces and windows do not; cancel close preserves ownership',async()=>{
  let opens=0,accept=false;
  const port={open:async()=>({id:String(++opens),url:'tool://document'}),request:async()=>null,close:async()=>accept};
  const a=createToolViewController(port),b=createToolViewController(port);
  assert.equal((await a.open('w',target)).id,(await a.open('w',target)).id);
  assert.notEqual((await a.open('w',target)).id,(await a.open('other',target)).id);
  assert.notEqual((await a.open('w',target)).id,(await b.open('w',target)).id);
  assert.equal(await a.close('w',target),false);assert.equal(opens,3);
  accept=true;assert.equal(await a.close('w',target),true);await a.open('w',target);assert.equal(opens,4);
});
test('tool tabs survive chat and workspace navigation without creating semantic leases',()=>{
  let state,opens=0;
  const controller=createSidebarController({windowId:'w',storage:null,viewState:createViewStateStore(),publish:value=>state=value,port:{open:()=>{opens++;throw Error('must not open semantic view')},release:async()=>{},cancelOpen:async()=>{}}});
  const item={...target,toolView:true,title:'Tool',available:true,issue:null,scope:'workspace'};
  controller.setCatalog([item]);controller.setContext({workspaceId:'a',sessionId:'first'});controller.openPlugin(item);
  controller.setContext({workspaceId:'a',sessionId:'second'});assert.equal(state.layout.tabs.length,3);
  controller.setContext({workspaceId:'b',sessionId:null});assert.equal(state.layout.tabs.length,2);
  controller.setContext({workspaceId:'a',sessionId:null});assert.equal(state.layout.tabs.length,3);assert.equal(opens,0);
});

test('tool tabs are ephemeral across restart and survive cancelled closure without crossing scopes',()=>{
  const data=new Map();const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  let state;const item={...target,toolView:true,title:'Tool',available:true,issue:null,scope:'workspace'};
  const create=()=>createSidebarController({windowId:'main',storage,viewState:createViewStateStore(),publish:value=>state=value,port:{open:()=>{throw Error('semantic call')},release:async()=>{},cancelOpen:async()=>{}}});
  const first=create();first.setCatalog([item]);first.setContext({workspaceId:'w',sessionId:'s'});first.openPlugin(item);first.setCatalog([]);first.dispose();
  const next=create();next.setContext({workspaceId:'w',sessionId:'s'});next.setCatalog([item]);assert.equal(state.layout.tabs.length,2);next.dispose();
});
