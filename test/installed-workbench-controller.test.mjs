import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstalledWorkbenchController, installedWorkbenchPresentation} from '../src/lib/app/installed-workbench-controller.ts';
import {createCapabilityWorkbenchDirectory} from '../src/lib/presentation-runtime/capability-workbench.ts';
import {createViewStateStore} from '../src/lib/app/view-state-storage.ts';
const contribution={installationId:'installation',contributionId:'dev.example.tool',title:'Tool',available:true,issue:null};
const fixture={schema:'aibo.semantic-view/v1',context:{workspaceId:'w',contributionId:contribution.contributionId,generation:'generation',revision:1},contribution:{id:contribution.contributionId,extensionPoint:'workspace.tool',title:'Tool'},state:{status:'ready',message:''},view:{kind:'collection',properties:[{key:'name',label:'Name',type:'text',values:[]}],items:[{id:'item',values:{name:'Item'}}],selection:null,page:{offset:0,size:50,total:1,truncated:false}},actions:[{id:'inspect',label:'Inspect',intent:'inspect',enabled:true},{id:'refresh',label:'Refresh',intent:'refresh',enabled:true}]};
test('host capability controller owns navigation state and lease until explicit disposal',async()=>{
 let state,opens=0,acts=0;const released=[];
 const controller=createInstalledWorkbenchController({open:async()=>{opens++;return structuredClone(fixture)},cancelOpen:async()=>{},release:async id=>released.push(id),act:async message=>{acts++;return {...structuredClone(fixture),context:{...fixture.context,revision:2},view:{kind:'detail',itemId:'item',properties:[],content:'Full detail',truncated:false}}}},createViewStateStore(),value=>state=value);
 await controller.open('w',contribution);assert.equal(state.restoring,false);
 controller.toggleLayout();assert.equal(state.layout,'sidebar');assert.equal(opens,1);assert.equal(released.length,0);
 await controller.act({context:{...fixture.context,revision:0},actionId:'inspect',itemId:'item'});assert.equal(acts,0);assert.equal(state.focusTarget,null);
 await controller.act({context:fixture.context,actionId:'inspect',itemId:'invalid'});assert.equal(acts,0);
 await controller.act({context:fixture.context,actionId:'inspect',itemId:'item'});assert.equal(state.snapshot.view.content,'Full detail');assert.equal(state.focusTarget,'item');
 controller.toggleReading();assert.equal(state.enhanced,false);assert.equal(opens,1);
 controller.dispose();controller.dispose();assert.deepEqual(released,['generation']);
});
test('late capability open after close releases its lease without republishing',async()=>{
 let resolve,state,publishes=0;const released=[];
 const controller=createInstalledWorkbenchController({open:()=>new Promise(done=>resolve=done),cancelOpen:async()=>{},release:async id=>released.push(id),act:async()=>fixture},createViewStateStore(),value=>{state=value;publishes++});
 const pending=controller.open('w',contribution);controller.dispose();const before=publishes;resolve(structuredClone(fixture));await pending;
 assert.equal(publishes,before);assert.equal(state.snapshot,null);assert.deepEqual(released,['generation']);
});
test('external capability actions retain semantic context and reject replaced snapshots and unavailable catalog entries',()=>{
 const state={catalog:[contribution,{...contribution,installationId:'disabled',available:false}],selected:contribution,scope:{kind:'workspace',id:'w'},view:{snapshot:fixture,error:'',enhanced:true,layout:'central',focusTarget:null,restoring:false}};
 const directory=createCapabilityWorkbenchDirectory();const actions=directory.project(state);assert.equal(actions.filter(a=>a.operation==='open').length,1);
 const selected=actions.find(a=>a.operation==='semantic'&&JSON.parse(a.args[0]).actionId==='inspect');const context={workspaceId:'w',sessionId:null,revision:3};
 assert.equal(JSON.parse(directory.resolve(state,context,{id:selected.token,event:'click',context,value:'forged'}).args[0]).itemId,'item');
 assert.equal(directory.resolve({...state,view:{...state.view,snapshot:{...fixture,context:{...fixture.context,revision:2}}}},context,{id:selected.token,event:'click',context}),null);
 assert.equal(directory.resolve({...state,view:{...state.view,restoring:true}},context,{id:selected.token,event:'click',context}),null);
});

test('host loading and failure messages switch language without changing plugin text, context or write gates',async()=>{
 let state, resolve;
 const read = new Promise(done=>resolve=done);
 const provider = {...structuredClone(fixture),schema:'aibo.semantic-view/v1.1',state:{status:'ready',message:'插件原文'},actions:[...fixture.actions,{id:'example.write',label:'写入原文',intent:'execute',enabled:true,input:{}}]};
 const controller=createInstalledWorkbenchController({open:async()=>provider,cancelOpen:async()=>{},release:async()=>{},write:async()=>{throw Error('outcome_unknown')},act:async()=>read},createViewStateStore(),value=>state=value);
 await controller.open('w',contribution);
 assert.equal(installedWorkbenchPresentation(state,'en').snapshot.state.message,'插件原文');
 const pending=controller.act({context:provider.context,actionId:'refresh',itemId:null});
 const en=installedWorkbenchPresentation(state,'en'),zh=installedWorkbenchPresentation(state,'zh-CN');
 assert.equal(en.snapshot.state.message,'Reading…');assert.equal(zh.snapshot.state.message,'正在读取…');
 assert.deepEqual(en.snapshot.context,provider.context);assert.equal(en.snapshot.actions.at(-1).label,'写入原文');
 assert.equal('hostMessage' in en,false);assert.equal(state.snapshot.state.message,'');
 resolve({...provider,context:{...provider.context,revision:2}});await pending;
 assert.equal(state.hostMessage,null);assert.equal(installedWorkbenchPresentation(state,'en').snapshot.state.message,'插件原文');
 await controller.act({context:state.snapshot.context,actionId:'example.write',itemId:null});
 assert.match(installedWorkbenchPresentation(state,'en').error,/outcome is unknown/);
 assert.match(installedWorkbenchPresentation(state,'zh-CN').error,/结果未知/);
 assert.equal(state.snapshot.actions.at(-1).enabled,false);assert.equal(installedWorkbenchPresentation(state,'en').snapshot.state.message,'插件原文');
 controller.dispose();
});
