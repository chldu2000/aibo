import test from 'node:test';
import assert from 'node:assert/strict';
import {controlInput,controlPreflights,modelSelections} from '../src/lib/presentation-runtime/controls.ts';
const props={columns:[{id:'high',label:'High',description:null}],rows:[{reference:'model-a',label:'Model A',isDefault:true,active:true,defaultActive:true,cells:[{id:'high',label:'High',description:null,available:true,active:false},{id:'unsupported',label:'Unsupported',description:null,available:false,active:false}]}],defaultLabel:'Default',defaultTitle:'Default',disabled:false,onSelect(){throw Error('must not invoke');}};
test('control projection omits executable callbacks and retains meaningful state',()=>{
 const input=controlInput('ModelMatrix',props,{workspaceId:'w',sessionId:'s',revision:2});
 assert.equal(input.data.props.onSelect,undefined);assert.deepEqual(input.data.props.rows,props.rows);
 assert.notEqual(input.data.props.rows,props.rows);assert.equal(input.data.actions.length,2);
 assert.deepEqual(input.data.actions.map(a=>[a.model,a.reasoningEffort]),[['model-a',null],['model-a','high']]);
});
test('disabled controls expose no host actions, and unsupported cells are never actionable',()=>{
 assert.deepEqual(modelSelections({...props,disabled:true}),[]);
 assert.ok(modelSelections(props).every(action=>action.reasoningEffort!=='unsupported'));
 assert.deepEqual(controlPreflights().map(input=>input.data.control),['ModelMatrix','AgentStatusMark']);
});
