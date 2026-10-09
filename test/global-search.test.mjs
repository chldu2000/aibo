import test from 'node:test';
import assert from 'node:assert/strict';
import {translateMessage} from '../packages/i18n/index.js';
import { createDoubleShift, createSearchController, searchCatalog, parseSearch } from '../src/lib/app/global-search.ts';
const result = (id, title = id) => ({ id, kind: 'session', title, description: '中文路径', target: { source: 'session', id }, score: 50 });
test('search merges independent sources, keeps partial success, and drops stale responses after query or close', async () => {
  const pending = []; let state;
  const controller = createSearchController({ publish: value => state = value, sources: [
    { id: 'local', search: async () => ({items:[result('local')],warnings:[],hasMore:false}) },
    { id: 'db', search: (request, signal) => new Promise((resolve, reject) => pending.push({resolve,reject,signal})) },
  ] });
  const first = controller.search('old'); await Promise.resolve();
  const second = controller.search('new'); await Promise.resolve();
  assert.equal(pending[0].signal.aborted,true);
  pending[1].reject(Error('offline')); await second;
  assert.equal(state.items[0].id,'local'); assert.match(translateMessage('en',state.errors[0]),/offline/);
  pending[0].resolve({items:[result('stale')],warnings:[],hasMore:false}); await first;
  assert.equal(state.query,'new'); assert.equal(state.items.length,1);
  const third = controller.search('close'); controller.close(); const snapshot = state;
  pending[2].resolve({items:[result('closed')],warnings:[],hasMore:false}); await third;
  assert.equal(state,snapshot);
});
test('catalog supports Chinese, scope, prefixes and exact-over-fuzzy ranking', () => {
  assert.deepEqual(parseSearch('> 设置',null),{query:'设置',kind:'command'});
  assert.deepEqual(parseSearch('@ 中文',null),{query:'中文',kind:'session'});
  const page=searchCatalog([result('a','my-settings'),result('b','settings'),result('c','something')],{query:'settings',kind:null,workspaceId:null,limit:50});
  assert.equal(page.items[0].id,'b');
  assert.equal(searchCatalog([result('a')],{query:'中文',kind:null,workspaceId:null,limit:50}).items.length,1);
});
test('double Shift requires clean completed taps and survives neither chords nor IME nor repeat nor long holds', () => {
  const detector=createDoubleShift();
  const key=(type,time,extra={})=>detector.handle({type,key:'Shift',...extra},time);
  assert.equal(key('keydown',0),false); assert.equal(key('keyup',50),false);
  assert.equal(key('keydown',150),false); assert.equal(key('keyup',200),true);
  for(const extra of [{key:'A'},{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true}]){
    detector.reset(); key('keydown',0);key('keyup',20);key('keydown',50,extra);key('keydown',100);
    assert.equal(key('keyup',150),false);
  }
  detector.reset();key('keydown',0);key('keyup',1000);key('keydown',1100);assert.equal(key('keyup',1150),false);
  detector.reset();key('keydown',0);key('keyup',10);detector.reset();key('keydown',30);assert.equal(key('keyup',40),false);
});

test('malformed source responses are isolated and do not hide the working catalog', async () => {
  let state;
  const controller=createSearchController({publish:value=>state=value,sources:[
    {id:'catalog',search:async()=>({items:[result('valid')],hasMore:false,warnings:[]})},
    {id:'invalid',search:async()=>[]},
  ]});
  await controller.search('query');assert.deepEqual(state.items.map(item=>item.id),['valid']);assert.match(translateMessage('zh-CN',state.errors[0]),/无效结果/);
});

test('search errors retain translated source labels and raw provider details without changing source identity',async()=>{
 const {localizedMessage}=await import('../packages/i18n/index.js');let state;const calls=[];
 const controller=createSearchController({publish:value=>{state=value;},sources:[
  {id:'文件',label:localizedMessage('search.source.files'),search:async request=>{calls.push(request);throw Error('用户原始错误');}},
  {id:'bad-result',label:localizedMessage('search.source.history'),search:async()=>[]},
  {id:'provider-id',search:async()=>{throw Error('Original provider error');}},
 ]});
 const pending=controller.search('用户查询');assert.deepEqual(state.pending,['文件','bad-result','provider-id']);await pending;
 assert.equal(state.query,'用户查询');assert.equal(calls[0].query,'用户查询');
 assert.equal(translateMessage('en',state.errors[0]),'Files: 用户原始错误');
 assert.equal(translateMessage('zh-CN',state.errors[0]),'文件：用户原始错误');
 assert.equal(translateMessage('en',state.errors[1]),'History: The search source returned invalid results');
 assert.equal(translateMessage('en',state.errors[2]),'provider-id: Original provider error');
 assert.equal(state.pending.length,0);
});
