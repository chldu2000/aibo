import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationViewStateStore} from '../src/lib/presentation-runtime/view-state.ts';
const context={workspaceId:'w',sessionId:'s',revision:1};
const state={focus:{key:'draft',selection:[2,5]},scroll:[{key:'messages',x:0,y:500}],window:[0,0],disclosures:[{key:'models',open:true}]};
test('visual state transfers between skins but stays isolated by workspace/session and bounded by eviction',()=>{
 const store=createPresentationViewStateStore(2);store.write(context,{...state,draft:'not visual state'});assert.equal(store.read(context).draft,undefined);
 const read=store.read({...context,revision:99});assert.deepEqual(read,state);read.scroll[0].y=0;assert.equal(store.read(context).scroll[0].y,500);
 assert.equal(store.read({...context,sessionId:'other'}),undefined);
 store.write({...context,sessionId:'other'},state);store.write({...context,workspaceId:'other'},state);assert.equal(store.read(context),undefined);
 store.clear();assert.equal(store.read({...context,workspaceId:'other'}),undefined);
});
test('visual state rejects malformed, oversized and non-finite state without replacing a valid restore point',()=>{
 const store=createPresentationViewStateStore();store.write(context,state);
 for(const value of [null,{}, {...state,window:[NaN,0]}, {...state,focus:{key:'x'.repeat(257),selection:null}}, {...state,scroll:Array(1025).fill(state.scroll[0])}, {...state,disclosures:[{key:'models',open:'yes'}]}, {...state,focus:{key:'draft',selection:[-1,0]}}]){store.write(context,value);assert.deepEqual(store.read(context),state);}
});
