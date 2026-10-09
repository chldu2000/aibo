import { translateMessage } from '../packages/i18n/index.js';
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
    wrong=true;await controller.refresh();assert.match(translateMessage('zh-CN',state.error),/不匹配/);assert.equal(state.page.session.workspaceId,'w');
    assert(calls.every(call=>call.workspaceId==='w'&&call.id==='archived'));
  }finally{controller?.close();await server.close();}
});

test('search anchor survives older/newer navigation and latest explicitly leaves the hit',async()=>{
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {createSessionHistoryController}=await server.ssrLoadModule('/src/lib/app/session-history-controller.ts');let state;const calls=[];
    const cursor={schema:'aibo.session-history-cursor/v1',workspaceId:'w',sessionId:'s',createdAt:'time',sequence:'1',id:'boundary'};
    const controller=createSessionHistoryController({list:async()=>[session('w','s')],read:async(w,s,before)=>{calls.push('read');return page(w,s,before?null:cursor);},readAround:async(w,s,id)=>{calls.push(id);return page(w,s,cursor);},publish:next=>state=next});
    await controller.open('w','s','hit');assert.equal(state.targetMessageId,'hit');assert.equal(calls.at(-1),'hit');
    await controller.older();assert.equal(calls.at(-1),'read');await controller.newer();assert.equal(calls.at(-1),'hit');
    await controller.latest();assert.equal(state.targetMessageId,null);assert.equal(calls.at(-1),'read');controller.close();
  }finally{await server.close();}
});


test('history translates explicit system display metadata without changing the canonical page, cursor, scope, or raw bodies',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try{
  const {createSessionHistoryController,sessionHistoryPresentation}=await server.ssrLoadModule('/src/lib/app/session-history-controller.ts');
  const keys=['workspace','cursor','sequence','messageWorkspace','messageRemoved'].map(key=>'native.history.'+key);
  let state, failure=null,reads=0;
  const cursor={schema:'aibo.session-history-cursor/v1',workspaceId:'w',sessionId:'s',createdAt:'time',sequence:'7',id:'last'};
  const display={schema:'aibo.host-message/v1',key:'native.session.controlChanged',params:{label:'原文 {label}'}};
  const source={...page('w','s',cursor),items:['system','user','assistant','tool'].map(role=>({id:role,sessionId:'s',role,content:'审批后切换到 原文 {label}',localizedContent:display}))};
  const controller=createSessionHistoryController({list:async()=>[session('w','s')],read:async()=>{reads++;if(failure)throw failure;return source;},publish:next=>state=next});
  await controller.open('w','s');const canonical=structuredClone(state),count=reads;
  for(const locale of ['zh-CN','en','zh-CN']){
   const projected=sessionHistoryPresentation(state,locale);
   assert.equal(projected.page.items[0].content,locale==='en'?'Switched to 原文 {label} after approval':'审批后切换到 原文 {label}');
   assert.deepEqual(projected.page.nextBefore,cursor);
   for(const item of projected.page.items.slice(1))assert.equal(item.content,'审批后切换到 原文 {label}');
   assert(projected.page.items.every(item=>!('localizedContent' in item)));
   assert.deepEqual(state,canonical);assert.equal(reads,count);
  }
  for(const key of keys){
   failure={code:key.endsWith('Workspace')||key.endsWith('Removed')?'session_operation_error':'invalid_workspace_path',message:'原始诊断 {key}',localized:{schema:'aibo.host-message/v1',key,params:{}}};
   await controller.refresh(); const count=reads;
   for(const locale of ['en','zh-CN'])assert.notEqual(translateMessage(locale,sessionHistoryPresentation(state,locale).error),failure.message);
   assert.equal(reads,count);assert.deepEqual(state.page,source,'a failed refresh preserves the last complete page');
  }
  failure={message:'原始诊断 {key}',localized:{schema:'aibo.host-message/v1',key:'native.history.unknown',params:{}}};await controller.refresh();assert.equal(translateMessage('en',state.error),failure.message);
  failure=null;await controller.refresh();assert.equal(state.error,null);controller.close();
 }finally{await server.close();}
});
