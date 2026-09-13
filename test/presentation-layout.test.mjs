import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayoutDirectory} from '../src/lib/presentation-runtime/layout.ts';
test('layout input is bounded, scoped and revoked when its panel closes',()=>{
 const state={navigation:{width:260,min:180,max:600},auxiliary:{width:320,min:220,max:520},auxiliaryOpen:true};
 const directory=createLayoutDirectory(),actions=directory.project(state);
 const context={workspaceId:'w',sessionId:'s',revision:2};
 const intent={id:actions[0].token,event:'input',value:'900',context};
 assert.deepEqual(directory.resolve(state,context,intent),{target:'navigation',width:600});
 assert.equal(directory.resolve(state,context,{...intent,value:'-40'}).width,180);
 for(const value of ['','NaN','Infinity','320px'])assert.equal(directory.resolve(state,context,{...intent,value}),null);
 assert.equal(directory.resolve(state,context,{...intent,context:{...context,sessionId:'other'}}),null);
 assert.equal(directory.resolve(state,context,{...intent,context:{...context,revision:3}}),null);
 assert.equal(directory.resolve({...state,auxiliaryOpen:false},context,{...intent,id:actions[1].token}),null);
});
