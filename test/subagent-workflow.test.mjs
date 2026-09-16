import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionCapability} from './helpers/session-capability.mjs';
const profile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'};

test('child work stays isolated, streams after dispatch and persists final states before the parent stream closes',async t=>{
  const f=await sessionCapability(t,'codex');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  assert.equal((await f.invoke('aibo.session.turn',{text:'subagents please'},'parent-turn')).status,'completed');
  const events=f.events.map(value=>value.event);
  const updates=events.filter(event=>event.type==='subagent.updated');
  assert.deepEqual([...new Set(updates.map(event=>event.payload.id))],['child-0','child-1']);
  assert.equal(updates.find(event=>event.payload.id==='child-0').payload.status,'pending');
  assert.equal(updates.filter(event=>event.payload.id==='child-0').at(-1).payload.status,'completed');
  assert.equal(updates.filter(event=>event.payload.id==='child-1').at(-1).payload.status,'failed');
  assert.ok(updates.every(event=>event.payload.rootTurnId==='parent-turn' && event.turnId===null));
  const history=events.filter(event=>event.type==='subagent.message');
  for(const child of ['child-0','child-1']) {
    const entries=new Map(history.filter(event=>event.payload.agentId===child).map(event=>[event.payload.entry.id,event.payload.entry]));
    assert.equal(entries.size,3);
    assert.ok([...entries.values()].some(entry=>entry.toolName==='reasoning'&&entry.content==='Checking files.'));
    assert.ok([...entries.values()].some(entry=>entry.role==='tool'&&entry.content.includes('src')));
    assert.ok([...entries.values()].some(entry=>entry.role==='assistant'&&entry.status==='completed'));
  }
  assert.equal(events.filter(event=>event.type==='message.completed').length,1,'child replies must not appear as parent messages');
  assert.ok(!JSON.stringify(events).includes('foreign secret'));
  assert.ok(events.findLastIndex(event=>event.type==='subagent.message') < events.findLastIndex(event=>event.type==='turn.completed'));
});

test('child cards update in place and stay outside tool groups; late history cannot overwrite live content',async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {handleAgentEvent}=await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
    const {parseSubagent,mergeSubagentEntries}=await server.ssrLoadModule('/src/lib/app/subagents.ts');
    const {groupTimelineItems}=await import('../packages/presentation-workbench/timeline-model.js');
    let timeline=[];
    const metadata={id:'child',parentId:'parent',rootTurnId:'turn',name:'Reader',task:'Read',activity:'Reading',status:'running'};
    const event={type:'subagent.updated',sessionId:'s',turnId:null,occurredAt:'now',payload:metadata};
    const apply=event=>handleAgentEvent(event,{selectedSessionId:'s',timeline,setTimeline:items=>timeline=items});
    apply(event);apply({...event,payload:{...metadata,status:'completed',activity:'Done'}});
    assert.equal(timeline.length,1);
    assert.equal(parseSubagent(timeline[0].content).status,'completed');
    apply({...event,sessionId:'another'});assert.equal(timeline.length,1);
    const tool={id:'tool',role:'tool',toolName:'shell',entryType:null,content:'output'};
    assert.deepEqual(groupTimelineItems([tool,...timeline,{...tool,id:'tool2'}]).map(item=>item.kind),['entry','entry','entry']);
    assert.deepEqual(mergeSubagentEntries([{id:'a',content:'old'}],[{id:'a',content:'new'},{id:'b',content:'next'}]).map(entry=>entry.content),['new','next']);
    assert.equal(parseSubagent(JSON.stringify({...metadata,status:'constructor'})),null);
  } finally {await server.close();}
});

test('child history catches up without native child notifications and reports unavailable history honestly',async t=>{
  for(const fails of [false,true]) await t.test(fails?'unavailable':'polling',async t=>{
    const f=await sessionCapability(t,'codex',{CODEX_FAKE_SUBAGENT_POLL_ONLY:'1',CODEX_FAKE_SUBAGENT_READ_FAIL:fails?'1':'0'});
    await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
    assert.equal((await f.invoke('aibo.session.turn',{text:'subagents please'},'parent')).status,'completed');
    const events=f.events.map(value=>value.event);
    const state=events.filter(event=>event.type==='subagent.updated'&&event.payload.id==='child-0').at(-1).payload;
    assert.equal(state.status,fails?'unavailable':'completed');
    if(!fails) assert.ok(events.some(event=>event.type==='subagent.message'&&event.payload.entry.content==='Review complete.'));
  });
});

test('a failed dispatch without a child thread remains visible as a failed tool',async t=>{
  const f=await sessionCapability(t,'codex');
  await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('aibo.session.turn',{text:'subagent spawn fails'},'parent');
  const failure=f.events.map(value=>value.event).find(event=>event.type==='tool.completed');
  assert.equal(failure.payload.status,'failed');
  assert.equal(failure.payload.summary,'Agent limit reached');
});
