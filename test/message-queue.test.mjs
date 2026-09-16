import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMessageQueue, newerMessageQueue } from '../src/lib/app/message-queue.ts';
import { conversationActions } from '../src/lib/presentation-runtime/conversation.ts';
import { renderConversation } from '../packages/presentation-workbench/conversation.js';
import { readFile } from 'node:fs/promises';
import { sessionCapability } from './helpers/session-capability.mjs';

test('queue snapshots retain stable identities and reject stale responses', () => {
 const snapshot=normalizeMessageQueue({items:[{id:'a',text:'same',status:'pending'},{id:'b',text:'same',status:'failed',error:'changed'}],revision:4,paused:true},'s');
 assert.deepEqual(snapshot.items.map(item=>item.id),['a','b']);
 assert.equal(snapshot.items[1].error,'changed');
 assert.equal(newerMessageQueue(snapshot,normalizeMessageQueue({items:[],revision:3},'s')),snapshot);
 assert.equal(newerMessageQueue(snapshot,normalizeMessageQueue({items:[],revision:0},'other')).sessionId,'other');
});

test('queue item actions are available at idle, scoped by ID, and disabled after claim', async () => {
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.session.capabilities.push('queue.manage'); state.running=false; state.busy=false;
 state.queue=normalizeMessageQueue({items:[{id:'a',text:'same',status:'pending'},{id:'b',text:'same',status:'sending'},{id:'c',text:'unknown',status:'uncertain'}],paused:true},state.session.id);
 const actions=conversationActions(state);
 assert.deepEqual(actions.filter(a=>a.operation==='removeQueuedMessage').map(a=>a.args[0]),['a','c']);
 assert.deepEqual(actions.filter(a=>a.operation==='sendQueuedMessage').map(a=>a.args[0]),['a']);
 assert.ok(!actions.some(a=>a.operation==='resumeQueue'));
 assert.ok(!conversationActions({...state,busy:true}).some(a=>a.operation==='removeQueuedMessage'));
 const nodes=[];const visit=node=>{nodes.push(node);node.children?.forEach(visit);};visit(renderConversation(state,actions.map((a,i)=>({...a,token:String(i)}))));
 assert.ok(nodes.some(node=>node.key==='queue:send:a'&&node.events?.click));
 assert.ok(!nodes.find(node=>node.key==='queue:send:b').events?.click);
});

test('Codex steering appends to the active native turn without starting another turn', async t => {
 const f=await sessionCapability(t,'codex');
 const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:{filesystemPolicy:'read-only',approvalPolicy:'on-request',approvalReviewer:'user'}});
 assert.ok(opened.capabilities.includes('queue.manage'));
 const turn=f.startTurn('host queue delay');
 await f.wait('turn.started');
 const result=await f.control(turn,'dev.aibo.codex.queue.manage',{action:'steer',message:'focus on tests'});
 assert.equal(result.accepted,true);
 assert.equal(result.turnId,'native-turn');
 await turn.done;
 assert.equal(f.events.filter(e=>e.event.type==='turn.started').length,1);
 assert.ok(f.events.some(e=>e.event.type==='message.delta'&&e.event.payload.delta==='focus on tests'));
 await assert.rejects(f.invoke('dev.aibo.codex.queue.manage',{action:'steer',message:'too late'}),/no_active_turn/);
});
