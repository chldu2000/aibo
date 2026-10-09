import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectEditorController,emptyProjectEditor,parseProjectArgs,projectEditorPresentation} from '../src/lib/app/project-editor-controller.ts';
import {createInspectorDirectory,inspectorActions} from '../src/lib/presentation-runtime/inspector.ts';
test('project editor preserves failed saves, validates argv, and retains existing disabled state',async()=>{
 let current;let calls=0;let fail=true;
 const action={id:'a',workspaceId:'w',name:'Test',kind:'test',program:'pnpm',args:['run','test with spaces'],cwd:'.',enabled:false};
 const controller=createProjectEditorController({workspace:()=> 'w',actions:()=>[action],changed:(_id,state)=>current=state,saved(){},save:async input=>{calls++;if(fail)throw Error('save failed');assert.equal(input.enabled,false);assert.deepEqual(input.args,['run','test with spaces']);return {...action,...input,id:'a'};}});
 controller.edit('a');controller.change('name','Edited');await controller.save();assert.equal(current.open,true);assert.equal(current.error,'save failed');assert.equal(current.name,'Edited');
 controller.change('args','[1]');await controller.save();assert.equal(calls,1);assert.match(projectEditorPresentation(current,'zh-CN').error,/字符串数组/);assert.match(projectEditorPresentation(current,'en').error,/array of strings/);
 controller.change('args',JSON.stringify(action.args));fail=false;await controller.save();assert.equal(current.open,false);assert.equal(current.error,null);
 assert.deepEqual(parseProjectArgs('run\ntest'),['run','test']);
 assert.throws(()=>parseProjectArgs('[invalid JSON'),error=>error.localized?.key==='error.projectArgs');
});
test('pending project saves stay with their workspace and do not consume another draft',async()=>{
 let workspace='a';const states=new Map();let resolve;let writes=0;
 const controller=createProjectEditorController({workspace:()=>workspace,actions:()=>[],changed:(id,state)=>states.set(id,state),saved(){},save:input=>{writes++;return new Promise(done=>resolve=()=>done({...input,id:'saved'}));}});
 controller.edit(null);controller.change('name','A');const pending=controller.save();await controller.save();assert.equal(writes,1);
 controller.change('name','ignored while saving');assert.equal(states.get('a').name,'A');
 workspace='b';controller.edit(null);controller.change('name','B');resolve();await pending;
 assert.equal(states.get('b').name,'B');assert.equal(states.get('b').open,true);assert.equal(states.get('a').open,false);
});
test('project actions bind drafts, targets and editor generations without exposing arbitrary execution',()=>{
 const state={workspace:{id:'w',trust:'trusted'},desktop:true,session:null,busy:false,threadBusy:false,artifactPreview:{artifactId:null},projectEditor:{...emptyProjectEditor(),open:true,name:'Draft'},runningActionId:null,projectActions:[{id:'a',workspaceId:'w',enabled:true},{id:'disabled',workspaceId:'w',enabled:false}],projectActionRuns:[{id:'run',workspaceId:'w',status:'running'},{id:'other',workspaceId:'other',status:'running'}]};
 const context={workspaceId:'w',sessionId:null,revision:2};const dir=createInspectorDirectory();const actions=dir.project(state);
 assert.deepEqual(actions.filter(a=>a.operation==='runProjectAction').map(a=>a.args),[['a']]);
 assert.deepEqual(actions.filter(a=>a.operation==='cancelProjectAction').map(a=>a.args),[['run']]);
 const input=actions.find(a=>a.operation==='projectField');assert.equal(dir.resolve({...state,projectEditor:{...state.projectEditor,generation:1}},context,{id:input.token,event:'input',value:'old',context}),null);
 const save=actions.find(a=>a.operation==='saveProjectAction');assert.equal(dir.resolve({...state,projectEditor:{...state.projectEditor,name:'new'}},context,{id:save.token,event:'click',context}),null);
 assert.ok(!inspectorActions({...state,workspace:{id:'w',trust:'untrusted'}}).some(a=>a.operation==='runProjectAction'));
 assert.ok(!inspectorActions({...state,runningActionId:'a'}).some(a=>a.operation==='deleteProjectAction'));
});


test('mismatched save results keep the draft and never accept another action or workspace',async()=>{
 let editor;let result;const accepted=[];const requests=[];
 const action={id:'a',workspaceId:'w',name:'原始动作',kind:'test',program:'node',args:[],cwd:'.',enabled:false};
 const original=structuredClone(action);
 const controller=createProjectEditorController({workspace:()=> 'w',actions:()=>[action],changed:(_id,state)=>editor=state,saved:(...args)=>accepted.push(args),save:async input=>{requests.push(input);return result;}});
 controller.edit('a');controller.change('name','保留草稿');
 for(const wrong of [{...action,id:'other'},{...action,workspaceId:'other'}]){
  result=wrong;await controller.save();
  assert.equal(editor.open,true);assert.equal(editor.saving,false);assert.equal(editor.name,'保留草稿');assert.equal(editor.enabled,false);
  assert.equal(editor.error.key,'error.projectActionIdentity');
  const before=structuredClone(editor);
  for(const locale of ['zh-CN','en','zh-CN'])assert.ok(projectEditorPresentation(editor,locale).error.length);
  assert.deepEqual(editor,before);assert.deepEqual(action,original);assert.deepEqual(accepted,[]);
 }
 assert.equal(requests.length,2);
 result={...action,name:'保留草稿'};await controller.save();
 assert.equal(requests.length,3);assert.deepEqual(accepted,[['w',result]]);assert.equal(editor.open,false);assert.equal(editor.error,null);
});
