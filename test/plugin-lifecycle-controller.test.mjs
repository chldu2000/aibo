import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginLifecycleController } from '../src/lib/app/plugin-lifecycle-controller.ts';

function fixture() {
  let state, impact = { id:'old',token:'revision-1',sessions:[{id:'s',label:'Session'}],dependencies:[],bindings:[],active:0,targets:[{id:'new',label:'2.0.0'}] };
  const calls=[];
  const ports={
    readPolicy:async()=> 'automatic',savePolicy:async policy=>policy,
    preview:async()=>structuredClone(impact),
    remove:async(...args)=>{calls.push(['remove',...args]);},
    migrate:async(...args)=>{calls.push(['migrate',...args]);impact={...impact,sessions:[],token:'revision-2'};return {migrated:['s'],failed:[]};},
    refresh:async()=>{calls.push(['refresh']);}, publish:value=>{state=value;},
  };
  const controller=createPluginLifecycleController(ports);
  return {controller,ports,calls,get state(){return state;},set impact(value){impact=value;}};
}
test('migration refreshes the affected references before removal and retains policy failures',async()=>{
  const f=fixture();await f.controller.initialize();assert.equal(f.state.policy,'automatic');
  await f.controller.review('old');await f.controller.remove(false);assert.deepEqual(f.calls,[]);
  await f.controller.migrate('new');assert.equal(f.state.impact.token,'revision-2');
  await f.controller.remove(false);assert.deepEqual(f.calls.at(-2),['remove','old','revision-2',false]);assert.equal(f.state.impact,null);
  await f.controller.savePolicy('pinned');assert.equal(f.state.policy,'pinned');
  f.ports.savePolicy=async()=>{throw Error('storage unavailable');};
  await f.controller.savePolicy('ask');assert.equal(f.state.policy,'pinned');assert.match(f.state.error,/storage unavailable/);
});
test('history-only removal is explicit and stale confirmations are discarded',async()=>{
  const f=fixture();await f.controller.review('old');
  f.ports.remove=async()=>{throw Error('引用已变化');};
  await f.controller.remove(true);assert.equal(f.state.impact,null);assert.match(f.state.error,/引用已变化/);
  await f.controller.remove(true);assert.equal(f.calls.length,1);
});
test('dependency references block deletion and cancellation has no effect on data',async()=>{
  const f=fixture();f.impact={id:'old',token:'t',sessions:[],bindings:[],active:0,targets:[],dependencies:[{id:'dependent',label:'Tool'}]};
  await f.controller.review('old');await f.controller.remove(true);assert.deepEqual(f.calls,[]);
  f.controller.cancel();assert.equal(f.state.impact,null);assert.deepEqual(f.calls,[]);
});
test('busy migration cannot be duplicated and failures keep the review available',async()=>{
  const f=fixture();await f.controller.review('old');let reject;
  f.ports.migrate=()=>new Promise((_,fail)=>{reject=fail;});
  const pending=f.controller.migrate('new');await f.controller.remove(true);f.controller.cancel();assert.equal(f.state.busy,true);
  reject(Error('provider failed'));await pending;assert.equal(f.state.impact.id,'old');assert.equal(f.state.busy,false);assert.deepEqual(f.calls,[]);
});
