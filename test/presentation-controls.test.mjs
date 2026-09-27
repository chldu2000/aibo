import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {controlAvailable,controlInput,controlPreflights,decorativeLabel,isDecorativeControl,modelSelections,presentationControls,resolveControlIntent} from '../src/lib/presentation-runtime/controls.ts';
const props={columns:[{id:'high',label:'High',description:null}],rows:[{reference:'model-a',label:'Model A',isDefault:true,active:true,defaultActive:true,cells:[{id:'high',label:'High',description:null,available:true,active:false},{id:'unsupported',label:'Unsupported',description:null,available:false,active:false}]}],defaultLabel:'Default',defaultTitle:'Default',fastTier:{id:'priority',label:'Fast',description:null,active:false},disabled:false,onSelect(){throw Error('must not invoke');},onSelectServiceTier(){throw Error('must not invoke');}};
test('control projection omits executable callbacks and retains meaningful state',()=>{
 const input=controlInput('ModelMatrix',props,{workspaceId:'w',sessionId:'s',revision:2});
 assert.equal(input.data.props.onSelect,undefined);assert.deepEqual(input.data.props.rows,props.rows);
 assert.equal(input.data.props.onSelectServiceTier,undefined);assert.notEqual(input.data.props.rows,props.rows);assert.equal(input.data.actions.length,3);
 assert.deepEqual(input.data.actions.map(a=>a.kind==='serviceTier'?[a.kind,a.serviceTier]:[a.kind,a.model,a.reasoningEffort]),[['serviceTier','priority'],['model','model-a',null],['model','model-a','high']]);
});
test('disabled controls expose no host actions, and unsupported cells are never actionable',()=>{
 assert.deepEqual(modelSelections({...props,disabled:true}),[]);
 assert.ok(modelSelections(props).every(action=>action.kind!=='model'||action.reasoningEffort!=='unsupported'));
 assert.deepEqual(controlPreflights().map(input=>input.data.control),['ModelMatrix','AgentStatusMark']);
});
test('registry projection keeps the published control wire format byte for byte',()=>{
 // The pre-registry projection, frozen: existing controls packages must not need a rebuild.
 const legacy=(control,value,context)=>{const {onSelect:_s,onSelectServiceTier:_t,...data}=value;const payload=control==='ModelMatrix'?{control,props:data,actions:modelSelections(value)}:{control,props:value,actions:[]};return {surface:'controls',context,data:JSON.parse(JSON.stringify(payload)),theme:{}};};
 const context={workspaceId:'w',sessionId:'s',revision:2};
 const mark={agent:'plugin',tone:'running',label:'Cursor',icon:{path:'M0 0h24v24H0z'}};
 assert.equal(JSON.stringify(controlInput('ModelMatrix',props,context)),JSON.stringify(legacy('ModelMatrix',props,context)));
 assert.equal(JSON.stringify(controlInput('AgentStatusMark',mark,context)),JSON.stringify(legacy('AgentStatusMark',mark,context)));
});
test('intents resolve against current props to host callbacks only for live click tokens',async()=>{
 const calls=[];const live={...props,onSelect:(...args)=>calls.push(['model',...args]),onSelectServiceTier:tier=>calls.push(['tier',tier])};
 const [tier,plain,high]=modelSelections(live).map(action=>action.token);
 await resolveControlIntent('ModelMatrix',live,{id:high,event:'click'})();
 await resolveControlIntent('ModelMatrix',live,{id:plain,event:'click'})();
 await resolveControlIntent('ModelMatrix',live,{id:tier,event:'click'})();
 assert.deepEqual(calls,[['model','model-a','high'],['model','model-a',null],['tier','priority']]);
 assert.equal(resolveControlIntent('ModelMatrix',live,{id:high,event:'input'}),null,'only click selects');
 assert.equal(resolveControlIntent('ModelMatrix',live,{id:'model:99',event:'click'}),null,'unknown token');
 assert.equal(resolveControlIntent('ModelMatrix',{...live,disabled:true},{id:high,event:'click'}),null,'disabled after render');
 assert.equal(resolveControlIntent('AgentStatusMark',{agent:'plugin',tone:'idle',label:'P'},{id:'x',event:'click'}),null);
 assert.equal(isDecorativeControl('AgentStatusMark'),true);assert.equal(isDecorativeControl('ModelMatrix'),false);
 assert.equal(decorativeLabel('AgentStatusMark',{agent:'plugin',tone:'idle',label:'Plugin'}),'Plugin');
});
test('the external control bridge never branches on control names',async()=>{
 for(const file of ['src/lib/ui-kit/runtime/ExternalControl.svelte','src/lib/ui-kit/runtime/PublicControl.svelte']){
  const source=await readFile(file,'utf8');
  for(const control of presentationControls) assert.ok(!source.includes(control),`${file} must dispatch through the control registry, found ${control}`);
 }
});
test('controls added after host API 1.0.0 only reach packages declaring the newer API',()=>{
 assert.deepEqual(presentationControls,['ModelMatrix','AgentStatusMark','FileChangeMark','SessionControlMark']);
 assert.deepEqual(controlPreflights().map(input=>input.data.control),['ModelMatrix','AgentStatusMark'],'published 1.0.0 packages see the original catalog');
 assert.deepEqual(controlPreflights('1.1.0').map(input=>input.data.control),presentationControls);
 assert.equal(controlAvailable('FileChangeMark','1.0.0'),false);assert.equal(controlAvailable('FileChangeMark','1.1.0'),true);
 assert.equal(controlAvailable('ModelMatrix','9.0.0'),false,'unknown host APIs receive nothing');
});
test('display-only marks project host labels and policy classification, never callbacks or plugin identity',()=>{
 const context={workspaceId:'w',sessionId:'s',revision:1};
 assert.deepEqual(controlInput('FileChangeMark',{kind:'conflicted'},context).data,{control:'FileChangeMark',props:{kind:'conflicted',label:'合并冲突',decorative:false},actions:[]});
 assert.equal(decorativeLabel('FileChangeMark',{kind:'added'}),'新增');
 assert.equal(decorativeLabel('FileChangeMark',{kind:'added',decorative:true}),null,'decorative marks stay hidden from assistive technology');
 const control={id:'write',kind:'mode',label:'Agent',description:'x',command:'agent',profile:{interactionMode:'edit',filesystemPolicy:'agent-managed'}};
 const data=controlInput('SessionControlMark',{control,compact:true},context).data;
 assert.deepEqual(data,{control:'SessionControlMark',props:{kind:'mode',profile:control.profile,compact:true,appearance:{icon:'edit',tone:'write'}},actions:[]});
 assert.equal(decorativeLabel('SessionControlMark',{control}),null);
 for(const name of ['FileChangeMark','SessionControlMark']){assert.equal(isDecorativeControl(name),true);assert.equal(resolveControlIntent(name,{kind:'added',control},{id:'x',event:'click'}),null);}
});
