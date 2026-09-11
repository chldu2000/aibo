import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const scope=id=>({kind:'workspace',id});
const catalog=(items,nextBefore=null)=>({schema:'aibo.capability-history-scopes/v1',items:items.map(id=>({scope:scope(id),label:id})),nextBefore});
const page=(id,nextBefore=null)=>({schema:'aibo.capability-history-events/v1',scope:scope(id),events:[{sequence:'9007199254740994',payload:{capability:'fixture.read'}}],nextBefore});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('audit readers discard obsolete catalogs and event pages, and preserve opaque cursor precision',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
 try{
  const {createCapabilityHistoryController}=await server.ssrLoadModule('/src/lib/app/capability-history-controller.ts');
  const catalogs=[],reads=[];let state;
  controller=createCapabilityHistoryController({list:before=>{const pending=deferred();catalogs.push({before,...pending});return pending.promise;},read:(scope,before)=>{const pending=deferred();reads.push({scope,before,...pending});return pending.promise;},publish:next=>state=next});
  const old=controller.open();const opened=controller.open();catalogs[1].resolve(catalog(['a','b'],'9007199254740995'));await Promise.resolve();
  const selected=controller.select(scope('b'));reads[1].resolve(page('b','9007199254740994'));await selected;
  reads[0].resolve(page('a'));await opened;catalogs[0].reject(Error('obsolete'));await old;
  assert.equal(state.selected.id,'b');assert.equal(state.page.scope.id,'b');assert.equal(state.error,null);
  const older=controller.older();assert.equal(reads.at(-1).before,'9007199254740994');reads.at(-1).resolve(page('b'));await older;assert.equal(state.pageNumber,2);
  const newer=controller.newer();assert.equal(reads.at(-1).before,null);reads.at(-1).resolve(page('b'));await newer;
  const more=controller.moreScopes();assert.equal(catalogs.at(-1).before,'9007199254740995');catalogs.at(-1).resolve(catalog(['b','c']));await more;assert.equal(state.scopes.length,3);
  const late=controller.refresh();controller.close();reads.at(-1).resolve(page('a'));await late;assert.equal(state.page.scope.id,'b');
 }finally{controller?.close();await server.close();}
});
test('audit scope failures remain recoverable without enabling or invoking a provider',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
 try{
  const {createCapabilityHistoryController}=await server.ssrLoadModule('/src/lib/app/capability-history-controller.ts');let state,fail=true,wrong=false;
  controller=createCapabilityHistoryController({list:async()=>{if(fail)throw Error('database unavailable');return catalog(['deleted']);},read:async()=>page(wrong?'other':'deleted'),publish:next=>state=next});
  await controller.open();assert.match(state.error,/unavailable/);fail=false;await controller.open();assert.equal(state.page.scope.id,'deleted');
  wrong=true;await controller.refresh();assert.match(state.error,/不匹配/);assert.equal(state.page.scope.id,'deleted');
 }finally{controller?.close();await server.close();}
});

test('legacy snapshots have an isolated source and reject late or mismatched event responses',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
 try{
  const {createCapabilityHistoryController}=await server.ssrLoadModule('/src/lib/app/capability-history-controller.ts');
  const pending=deferred();let state,wrong=false;const sources=[];
  controller=createCapabilityHistoryController({
   list:async(_before,source)=>({...catalog(['deleted']),source}),
   read:async(_scope,_before,source)=>{sources.push(source);if(source==='events')return pending.promise;return {...page('deleted'),source:wrong?'events':'legacy',events:[{sequence:'1',payload:{type:'legacy_snapshot',status:'completed'}}]};},
   publish:next=>state=next,
  });
  const opening=controller.open();await new Promise(resolve=>setTimeout(resolve,0));
  await controller.selectSource('legacy');assert.equal(state.source,'legacy');assert.equal(state.page.events[0].payload.type,'legacy_snapshot');
  pending.resolve(page('deleted'));await opening;assert.equal(state.page.source,'legacy');
  wrong=true;await controller.refresh();assert.match(state.error,/不匹配/);assert.equal(state.page.source,'legacy');
  wrong=false;await controller.open();assert.equal(state.source,'legacy');assert.equal(sources.at(-1),'legacy');
  controller.close();await controller.open();assert.equal(state.source,'events');
 }finally{controller?.close();await server.close();}
});
