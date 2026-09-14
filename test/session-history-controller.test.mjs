import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const session=(workspaceId,id)=>({workspaceId,id,label:id,archived:false});
const page=(workspaceId,id,nextBefore=null)=>({schema:'aibo.session-history-page/v1',source:'persisted-core',session:session(workspaceId,id),items:[{sessionId:id,id:`message-${id}`}],nextBefore});

test('persisted session history rejects late catalog/message results without starting or changing a session',async()=>{
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
  try {
    const {createSessionHistoryController}=await server.ssrLoadModule('/src/lib/app/session-history-controller.ts');
    const catalogs=[],reads=[];let state;
    controller=createSessionHistoryController({list:workspaceId=>{const pending=deferred();catalogs.push({workspaceId,...pending});return pending.promise;},read:(workspaceId,sessionId,before)=>{const pending=deferred();reads.push({workspaceId,sessionId,before,...pending});return pending.promise;},publish:next=>state=next});
    const old=controller.open('old');const current=controller.open('current');
    catalogs[1].resolve([session('current','first'),session('current','second')]);await Promise.resolve();
    const selected=controller.select('second');reads[1].resolve(page('current','second'));await selected;
    reads[0].resolve(page('current','first'));await current;
    catalogs[0].reject(Error('old catalog failure'));await old;
    assert.equal(state.selectedId,'second');assert.equal(state.page.session.id,'second');assert.equal(state.error,null);
    const late=controller.refresh();const count=reads.length;controller.close();reads.at(-1).resolve(page('current','second'));await late;
    assert.equal(reads.length,count);assert.equal(state.page.session.id,'second');
  }finally{controller?.close();await server.close();}
});

test('history paging retains read scope, returns to newer/latest messages, and reports incompatible responses',async()=>{
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});let controller;
  try {
    const {createSessionHistoryController}=await server.ssrLoadModule('/src/lib/app/session-history-controller.ts');let state;const calls=[];let wrong=false;
    const cursor={schema:'aibo.session-history-cursor/v1',workspaceId:'w',sessionId:'archived',createdAt:'time',sequence:'9223372036854775806',id:'boundary'};
    controller=createSessionHistoryController({list:async()=>[{...session('w','archived'),archived:true}],read:async(workspaceId,id,before)=>{calls.push({workspaceId,id,before});return page(wrong?'other':workspaceId,id,before?null:cursor);},publish:next=>state=next});
    await controller.open('w','archived');assert.equal(state.selectedId,'archived');
    await controller.older();assert.equal(state.pageNumber,2);assert.equal(calls.at(-1).before.sequence,'9223372036854775806');
    await controller.newer();assert.equal(state.pageNumber,1);assert.equal(calls.at(-1).before,null);
    await controller.older();await controller.latest();assert.equal(state.pageNumber,1);assert.equal(calls.at(-1).before,null);
    wrong=true;await controller.refresh();assert.match(state.error,/不匹配/);assert.equal(state.page.session.workspaceId,'w');
    assert(calls.every(call=>call.workspaceId==='w'&&call.id==='archived'));
  }finally{controller?.close();await server.close();}
});
