import { translateMessage } from '../packages/i18n/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPluginInstallController,pluginInstallStatePresentation} from '../src/lib/app/plugin-install-controller.ts';
function fixture(kind='upgrade') {
  let state;const calls=[];
  const preview={pluginId:'plugin',version:'2.0.0',kind,previous:['1.0.0'],token:'digest-and-references',impacts:[],blockers:[]};
  const ports={preview:async()=>preview,install:async(...args)=>calls.push(args),undo:async id=>calls.push(['undo',id]),undoTargets:async()=>['new'],refresh:async()=>{},publish:value=>state=value};
  return {ports,preview,calls,controller:createPluginInstallController(ports),get state(){return state;}};
}
test('replacement requires review and passes the exact confirmation token',async()=>{
  const f=fixture();await f.controller.confirm();assert.equal(f.calls.length,0);
  await f.controller.review('/package');await f.controller.confirm();assert.deepEqual(f.calls,[['/package','digest-and-references',false,true]]);assert.equal(f.state.preview,null);assert.deepEqual(f.state.undoTargets,['new']);
});
test('downgrade is only available through explicit destructive reinstall',async()=>{
  const f=fixture('downgrade');await f.controller.review('/old');await f.controller.confirm(false);assert.equal(f.calls.length,0);
  await f.controller.confirm(true);assert.deepEqual(f.calls,[['/old','digest-and-references',true,true]]);assert.match(translateMessage('zh-CN',f.state.notice),/仅保留历史/);
});
test('identical package is a no-op; blocked and cancelled installs make no writes',async()=>{
  const f=fixture('installed');await f.controller.review('/same');assert.match(translateMessage('zh-CN',f.state.notice),/无需重复/);await f.controller.confirm();assert.equal(f.calls.length,0);
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

test('cleanup failures keep host display metadata after installation and undo without repeating writes',async()=>{
  for(const action of ['install','undo']) {
    const f=fixture();
    const error={message:'插件存储路径不是安全目录',localized:{schema:'aibo.host-message/v1',key:'native.registry.storageDirectory',params:{}}};
    f.ports.undoTargets=async()=>{throw error;};
    if(action==='install'){await f.controller.review('/package');await f.controller.confirm();assert.deepEqual(f.calls,[['/package','digest-and-references',false,true]]);assert.equal(f.state.preview,null);}
    else {await f.controller.undo('new');assert.deepEqual(f.calls,[['undo','new']]);}
    assert.equal(f.state.busy,false);assert.equal(f.state.notice,'');
    for(const locale of ['zh-CN','en','zh-CN'])assert.equal(translateMessage(locale,f.state.error),locale==='en'?'The plugin storage path is not a safe directory.':error.message);
    assert.deepEqual(f.calls,action==='install'?[['/package','digest-and-references',false,true]]:[['undo','new']]);
    await assert.rejects(f.controller.refreshUndo(),value=>value===error);
    f.ports.undoTargets=async()=>['new'];await f.controller.refreshUndo();assert.deepEqual(f.state.undoTargets,['new']);
  }
});

test('archived sessions are skipped by default, can be included, and reset for the next review', async () => {
  const f=fixture(); await f.controller.review('/new'); assert.equal(f.state.skipArchived,true);
  f.controller.setSkipArchived(false); await f.controller.confirm();
  assert.deepEqual(f.calls,[['/new','digest-and-references',false,false]]);
  await f.controller.review('/next'); assert.equal(f.state.skipArchived,true);
});

test('install display metadata translates blockers without changing confirmation or raw plugin text', () => {
  const metadata=key=>({schema:'aibo.host-message/v1',key,params:{}});
  const state={preview:{pluginId:'插件原文',version:'1.0.0',kind:'upgrade',token:'fixed-token',previous:[],impacts:[],blockers:['原诊断','插件正文'],localizedBlockers:[metadata('native.plugin.running'),metadata('native.plugin.unknown')]},busy:false,error:'',notice:'',undoTargets:[],skipArchived:false};
  const original=structuredClone(state);
  const display=pluginInstallStatePresentation(state,'en');
  assert.equal(display.preview.blockers[0],'Stop the plugin’s running tasks before replacing this version.');
  assert.equal(display.preview.blockers[1],'插件正文');assert.equal(display.preview.token,'fixed-token');assert.equal(display.skipArchived,false);
  assert.equal(display.preview.localizedBlockers,undefined);assert.deepEqual(state,original);
  state.preview.localizedBlockers.pop();assert.deepEqual(pluginInstallStatePresentation(state,'en').preview.blockers,state.preview.blockers);
});
