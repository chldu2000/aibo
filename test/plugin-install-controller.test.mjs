import test from 'node:test';
import assert from 'node:assert/strict';
import {createPluginInstallController} from '../src/lib/app/plugin-install-controller.ts';
function fixture(kind='upgrade') {
  let state;const calls=[];
  const preview={pluginId:'plugin',version:'2.0.0',kind,previous:['1.0.0'],token:'digest-and-references',impacts:[],blockers:[]};
  const ports={preview:async()=>preview,install:async(...args)=>calls.push(args),undo:async id=>calls.push(['undo',id]),undoTargets:async()=>['new'],refresh:async()=>{},publish:value=>state=value};
  return {ports,preview,calls,controller:createPluginInstallController(ports),get state(){return state;}};
}
test('replacement requires review and passes the exact confirmation token',async()=>{
  const f=fixture();await f.controller.confirm();assert.equal(f.calls.length,0);
  await f.controller.review('/package');await f.controller.confirm();assert.deepEqual(f.calls,[['/package','digest-and-references',false]]);assert.equal(f.state.preview,null);assert.deepEqual(f.state.undoTargets,['new']);
});
test('downgrade is only available through explicit destructive reinstall',async()=>{
  const f=fixture('downgrade');await f.controller.review('/old');await f.controller.confirm(false);assert.equal(f.calls.length,0);
  await f.controller.confirm(true);assert.deepEqual(f.calls,[['/old','digest-and-references',true]]);assert.match(f.state.notice,/仅保留历史/);
});
test('identical package is a no-op; blocked and cancelled installs make no writes',async()=>{
  const f=fixture('installed');await f.controller.review('/same');assert.match(f.state.notice,/无需重复/);await f.controller.confirm();assert.equal(f.calls.length,0);
  f.preview.kind='upgrade';f.preview.blockers=['busy'];await f.controller.review('/new');await f.controller.confirm();assert.equal(f.calls.length,0);
  f.controller.cancel();assert.equal(f.state.preview,null);
});
test('failed or stale replacement discards approval and keeps the error',async()=>{
  const f=fixture();f.ports.install=async()=>{throw Error('引用已变化');};await f.controller.review('/new');await f.controller.confirm();assert.equal(f.state.preview,null);assert.match(f.state.error,/引用已变化/);
});
test('undo revalidates through the host and double submit does not duplicate installation',async()=>{
  const f=fixture();let finish;f.ports.install=()=>new Promise(resolve=>finish=resolve);
  await f.controller.review('/new');const pending=f.controller.confirm();await f.controller.confirm();assert.equal(f.state.busy,true);finish();await pending;
  await f.controller.undo('new');assert.deepEqual(f.calls,[['undo','new']]);
});
