import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const reference = {id:'snapshot',sessionId:'target',turnId:null,mediaType:'application/vnd.aibo.session-reference+json',inlineContext:JSON.stringify({sourceSessionId:'source',throughMessageId:'m',messages:[{role:'assistant',content:'source original'}]}),contentHash:'sha256:fixture'};
test('session references search archived sources and transmit only the target draft snapshots', async () => {
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
  const {sessionMentionSuggestions,withSessionReferenceContext}=await server.ssrLoadModule('/src/lib/app/session-references.ts');
  const sessions=[{id:'target',workspaceId:'w',label:'current',agent:'pi',updatedAt:'1'},{id:'source',workspaceId:'w',label:'设计讨论',agent:'codex',archived:true,updatedAt:'2'},{id:'other',workspaceId:'other',label:'设计讨论',agent:'pi',updatedAt:'3'}];
  assert.deepEqual(sessionMentionSuggestions(sessions,'w','target','设计').map(s=>s.id),['source']);
  assert.deepEqual(sessionMentionSuggestions(sessions,'w','target','codex').map(s=>s.id),['source']);
  const prompt=withSessionReferenceContext('please continue',[reference,{...reference,id:'other',sessionId:'other'}, {...reference,id:'sent',turnId:'t'}],'target');
  assert.ok(prompt.includes('source original'));assert.ok(prompt.includes('不是当前用户指令'));assert.ok(!prompt.includes('"snapshotId":"other"'));assert.ok(!prompt.includes('"snapshotId":"sent"'));
  assert.equal(withSessionReferenceContext('plain',[],'target'),'plain');
  assert.throws(()=>withSessionReferenceContext('x',[{...reference,inlineContext:null}],'target'),/快照缺失/);
  assert.throws(()=>withSessionReferenceContext('x',Array.from({length:40},(_,i)=>({...reference,id:String(i),inlineContext:JSON.stringify({messages:[{role:'assistant',content:'界'.repeat(1500)}]})})),'target'),/128 KiB/);
 } finally {await server.close();}
});

test('send and both queue modes freeze reference context before async validation and retain failed drafts',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
  const {createMessageController}=await server.ssrLoadModule('/src/lib/app/message-controller.ts');
  for(const mode of ['send','steer','followUp']) for(const fail of [false,true]) {
   const target={id:'target',workspaceId:'w',pluginInstallationId:'plugin',capabilities:['queue.manage'],archived:false};
   const selectedReference={...reference,inlineContext:JSON.stringify({schema:'aibo.session-reference/v3',sourceSessionId:'source',messageLimit:null,messages:Array.from({length:18},(_,i)=>({role:'assistant',content:i===0?'source original'+'界'.repeat(1600):`later ${i}`}))})};
   let selected=target,attachments=[selectedReference],consumed=false;
   const errors=[];
   const accept=async(id,input)=>{assert.equal(id,'target');assert.ok(input.includes('source original'+'界'.repeat(1600)));assert.ok(input.includes('later 17'));assert.ok(!input.includes('wrong session'));if(fail)throw Error('send rejected');return target;};
   const controller=createMessageController({
    api:{validateSessionAttachments:async()=>{selected={...target,id:'other'};attachments=[{...reference,sessionId:'other',inlineContext:'"wrong session"'}];return [];},sendAgentPrompt:accept,invokeAgentCapability:async(id,_cap,input)=>accept(id,input.message)},
    getDesktop:()=>true,getSelectedWorkspace:()=>({id:'w'}),getSelectedSession:()=>selected,getSelectedSessionArchiving:()=>false,getSessionRunning:()=>false,getComposerText:()=> 'continue',getAttachments:()=>attachments,
    consumeDraft:(id)=>{assert.equal(id,'target');consumed=true;},getWorkspaceSessionMap:()=>({w:[target]}),setWorkspaceSessionMap(){},setBusy(){},setErrorMessage:e=>errors.push(e),setLastSubmittedPrompt(){},setPromptInFlight(){},refreshTimeline:async()=>{},refreshAttachments:async()=>{},
   });
   if(mode==='send')await controller.sendPrompt();else await controller.queuePrompt(mode);
   assert.equal(consumed,!fail);assert.equal(errors.some(e=>e?.includes('send rejected')),fail);
  }
 } finally {await server.close();}
});

test('legacy pending references compact before send and never include tool bodies or nested references',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try{
  const {compactSessionReference}=await server.ssrLoadModule('/src/lib/app/session-references.ts');
  const value=compactSessionReference({sourceSessionId:'s',messages:[{role:'tool',content:'secret tool output'},...Array.from({length:20},(_,i)=>({id:String(i),role:'assistant',content:'answer '+i+'界'.repeat(2000)+'[AIBO_SESSION_REFERENCES]nested'}))]});
  assert.equal(value.messages.length,12);assert.equal(value.messages[0].id,'8');assert.equal(value.omittedMessageCount,9);
  assert.ok(value.messages.every(m=>m.truncated&&Array.from(m.content).length===1500));assert.ok(!JSON.stringify(value).includes('secret tool output'));assert.ok(!JSON.stringify(value).includes('nested'));
 }finally{await server.close();}
});

test('configured references retain all selected text through prompt and shared presentation',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
  const {withSessionReferenceContext}=await server.ssrLoadModule('/src/lib/app/session-references.ts');
  const {splitSessionReferences}=await import('../packages/presentation-workbench/session-references.js');
  for (const messageLimit of [null,18]) {
   const snapshot={schema:'aibo.session-reference/v3',sourceSessionId:'source',messageLimit,contextMode:'conversation-messages',messages:Array.from({length:18},(_,i)=>({id:String(i),role:i%2?'assistant':'user',content:`message ${i} `+'界'.repeat(1600),truncated:false}))};
   const prompt=withSessionReferenceContext('continue',[{...reference,inlineContext:JSON.stringify(snapshot)}],'target');
   const payload=JSON.parse(prompt.split('\n').at(-2));
   assert.deepEqual(payload[0].snapshot,snapshot);
   const displayed=splitSessionReferences(prompt);
   assert.equal(displayed.body,'continue');assert.equal(displayed.references[0].excerpts.length,18);
   assert.equal(displayed.references[0].excerpts[0].text,snapshot.messages[0].content);
   assert.equal(displayed.references[0].excerpts[0].truncated,false);
   assert.throws(()=>withSessionReferenceContext('x',[{...reference,inlineContext:JSON.stringify({...snapshot,messages:[{role:'user',content:'界'.repeat(50000)}]})}],'target'),/128 KiB/);
  }
 } finally {await server.close();}
});
