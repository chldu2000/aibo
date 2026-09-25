import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionModelCache} from '../src/lib/app/session-model-cache.ts';
const catalog={current:null,models:[],currentReasoningEffort:null,reasoningEfforts:[],currentServiceTier:null};
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('confirmed catalogs survive restart, remain session scoped and expire',()=>{
  const disk=storage();let now=100;
  const first=createSessionModelCache(disk,()=>now);
  first.set('one',catalog);
  assert.deepEqual(createSessionModelCache(disk,()=>now).get('one'),catalog);
  assert.equal(createSessionModelCache(disk,()=>now).get('two'),undefined);
  now+=8*86400000;
  assert.equal(createSessionModelCache(disk,()=>now).get('one'),undefined);
});

test('unavailable storage and malformed catalogs do not break session selection',()=>{
  const broken={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};
  const cache=createSessionModelCache(broken);
  cache.set('one',catalog);
  assert.deepEqual(cache.get('one'),catalog);
  const disk=storage();disk.setItem('aibo.session-models.v1',JSON.stringify([['one',{savedAt:Date.now(),catalog:{...catalog,models:[{label:'malformed'}]}}]]));
  assert.equal(createSessionModelCache(disk).get('one'),undefined);
});

test('concurrent catalog consumers share discovery, errors are retryable and mutations invalidate pending reads',async()=>{
  const cache=createSessionModelCache(null);let calls=0,finish;
  const load=()=>{calls++;return new Promise(resolve=>finish=resolve)};
  const a=cache.load('one',load), b=cache.load('one',load);
  assert.equal(calls,1);finish(catalog);
  assert.deepEqual(await a,await b);
  const old=cache.load('one',load);
  cache.invalidate('one');
  const staleFinish=finish;
  const next=cache.load('one',load);assert.equal(calls,3);
  staleFinish(catalog);await old;
  finish({...catalog,currentReasoningEffort:'high'});await next;
  await assert.rejects(cache.load('one',async()=>{throw Error('offline')}),/offline/);
  assert.deepEqual(await cache.load('one',async()=>catalog),catalog);
});
