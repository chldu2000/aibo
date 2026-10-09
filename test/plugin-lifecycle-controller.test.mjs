import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginLifecycleController, pluginRemovalImpactPresentation, pluginMigrationReportPresentation } from '../src/lib/app/plugin-lifecycle-controller.ts';

function fixture() {
  let state, impact = { id:'old',token:'revision-1',sessions:[{id:'s',label:'Session'}],dependencies:[],bindings:[],active:0,targets:[{id:'new',label:'2.0.0'}] };
  const calls=[];
  const ports={
    preview:async()=>structuredClone(impact),
    remove:async(...args)=>{calls.push(['remove',...args]);},
    migrate:async(...args)=>{calls.push(['migrate',...args]);impact={...impact,sessions:[],token:'revision-2'};return {migrated:['s'],failed:[]};},
    refresh:async()=>{calls.push(['refresh']);}, publish:value=>{state=value;},
  };
  const controller=createPluginLifecycleController(ports);
  return {controller,ports,calls,get state(){return state;},set impact(value){impact=value;}};
}
test('migration refreshes the affected references before removal',async()=>{
  const f=fixture();
  await f.controller.review('old');await f.controller.remove(false);assert.deepEqual(f.calls,[]);
  await f.controller.migrate('new');assert.equal(f.state.impact.token,'revision-2');
  await f.controller.remove(false);assert.deepEqual(f.calls.at(-2),['remove','old','revision-2',false]);assert.equal(f.state.impact,null);
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

test('removal display preserves raw references and confirmation while resolving only explicit host labels', () => {
  const impact={id:'old',token:'fixed-token',sessions:[{id:'s',label:'候选绑定原文'}],dependencies:[],bindings:[{id:'c',label:'原诊断',localizedLabel:{schema:'aibo.host-message/v1',key:'native.plugin.candidateBinding',params:{contribution:'原文{contribution}'}}},{id:'unknown',label:'插件原文',localizedLabel:{schema:'aibo.host-message/v1',key:'native.plugin.unknown',params:{}}}],active:0,targets:[]};
  const original=structuredClone(impact),display=pluginRemovalImpactPresentation(impact,'en');
  assert.equal(display.bindings[0].label,'原文{contribution} · candidate binding');
  assert.equal(display.bindings[1].label,'插件原文');assert.equal(display.sessions[0].label,'候选绑定原文');assert.equal(display.token,'fixed-token');
  assert.equal(display.bindings[0].localizedLabel,undefined);assert.deepEqual(impact,original);
});

test('migration failure projection keeps the original report and provider diagnostics', () => {
  const report={migrated:['success'],failed:[{id:'failed',label:'原诊断',localizedLabel:{schema:'aibo.host-message/v1',key:'native.plugin.migrationFailed',params:{label:'原始会话 {label}',reason:'原始提供者 {reason}'}}}]};
  const original=structuredClone(report),display=pluginMigrationReportPresentation(report,'en');
  assert.equal(display.failed[0].label,'原始会话 {label}: 原始提供者 {reason}');
  assert.equal(display.failed[0].localizedLabel,undefined);assert.deepEqual(display.migrated,['success']);assert.deepEqual(report,original);
});
