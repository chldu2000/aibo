import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectorActions,createInspectorDirectory} from '../src/lib/presentation-runtime/inspector.ts';
import {createArtifactPreviewController} from '../src/lib/app/artifact-preview-controller.ts';
const state={projectEditor:{open:false,saving:false},runningActionId:null,workspace:{id:'w',trust:'trusted'},session:{id:'s',workspaceId:'w',archived:false},desktop:true,open:true,activeView:'context',diagnostics:[],workspaceCapabilities:null,threads:[],executionProfile:null,attachments:[],artifacts:[{id:'a',sessionId:'s',workspaceId:'w'}],artifactPreview:{artifactId:null},projectActions:[],projectActionRuns:[],changeSet:{sessionId:'s',workspaceId:'w',turnId:'t',attribution:'agent',files:[{path:'clean',kind:'modified',baselineDirty:false},{path:'dirty',kind:'modified',baselineDirty:true},{path:'renamed',kind:'renamed',baselineDirty:false}]},checkpoints:[],restoreOperations:[],workspaceChanges:{workspaceId:'w',captureStatus:'captured'},fileDiff:{path:'clean',available:true,hunks:[{index:0,header:'@@',content:'diff'}]},fileDiffLoading:false,fileDiffError:null,threadBusy:false,busy:false,running:false,archiving:false};
const context={workspaceId:'w',sessionId:'s',revision:4};
test('Inspector targets current files and hunks while rejecting unsafe restores and foreign data',()=>{
 const entries=inspectorActions(state);
 assert.ok(entries.some(a=>a.operation==='restoreTurn'));
 assert.deepEqual(entries.filter(a=>a.operation==='toggleArtifact').map(a=>a.args),[['a']]);
 assert.ok(!entries.some(a=>a.operation==='fileAction'&&a.args[1]==='dirty'&&a.args[2]==='revert'));
 assert.equal(entries.filter(a=>a.operation==='hunkAction').length,3);
 assert.ok(!inspectorActions({...state,fileDiff:{...state.fileDiff,path:'renamed'}}).some(a=>a.operation==='hunkAction'));
 assert.ok(!inspectorActions({...state,changeSet:{...state.changeSet,attribution:'mixed'}}).some(a=>a.operation==='restoreTurn'));
 for(const changed of [{...state,running:true},{...state,workspace:{...state.workspace,trust:'untrusted'}},{...state,changeSet:{...state.changeSet,sessionId:'other'}}])assert.ok(!inspectorActions(changed).some(a=>['restoreTurn','fileAction','hunkAction'].includes(a.operation)));
});
test('Inspector revalidates targets and revokes old turn actions',()=>{
 const dir=createInspectorDirectory();const action=dir.project(state).find(a=>a.operation==='hunkAction');
 assert.deepEqual(dir.resolve(state,context,{id:action.token,event:'click',value:'forged',context}).args,['t','clean','0','stage']);
 assert.equal(dir.resolve({...state,fileDiff:null},context,{id:action.token,event:'click',context}),null);
 assert.equal(dir.resolve(state,context,{id:action.token,event:'click',context:{...context,revision:3}}),null);
 dir.project({...state,changeSet:{...state.changeSet,turnId:'new'}});dir.project(state);
 assert.equal(dir.resolve(state,context,{id:action.token,event:'click',context}),null);
});
test('host artifact preview ignores superseded and closed reads and preserves recoverable errors',async()=>{
 const pending=new Map();let session='s',latest;
 const controller=createArtifactPreviewController({currentSession:()=>session,available:()=>true,changed:value=>latest=value,read:(_s,id)=>new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))});
 const first=controller.toggle('s','a');const second=controller.toggle('s','b');
 pending.get('b').resolve({artifact:{id:'b',sessionId:'s'},content:'B',truncated:true});await second;
 pending.get('a').resolve({artifact:{id:'a',sessionId:'s'},content:'A',truncated:false});await first;assert.equal(latest.content.content,'B');
 const third=controller.toggle('s','c');controller.reset();pending.get('c').resolve({artifact:{id:'c',sessionId:'s'},content:'C'});await third;assert.equal(latest.artifactId,null);
 const fourth=controller.toggle('s','d');session='other';controller.reset();pending.get('d').reject(Error('old failure'));await fourth;assert.equal(latest.error,null);
 session='s';const invalid=controller.toggle('s','e');pending.get('e').resolve({artifact:{id:'wrong',sessionId:'s'},content:'bad'});await invalid;assert.equal(latest.error,'artifact_identity_mismatch');
 const retry=controller.toggle('s','e');pending.get('e').resolve({artifact:{id:'e',sessionId:'s'},content:'recovered',truncated:false});await retry;assert.equal(latest.content.content,'recovered');
});
