import test from 'node:test';
import assert from 'node:assert/strict';
import { gitActions, createGitDirectory } from '../src/lib/presentation-runtime/git.ts';
const state={workspace:{id:'w',label:'Workspace',path:'/repo',trust:'trusted'},sessionId:'s',desktop:true,open:true,activeView:'git',changes:{workspaceId:'w',head:'head',branch:'main',dirty:true,capturedAt:'now',captureStatus:'captured',captureError:null,files:[{path:'staged',previousPath:null,kind:'modified',staged:true,unstaged:false,untracked:false,conflicted:false},{path:'changed',previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false}]},loading:false,error:null,branches:[{name:'main',current:true,commit:'head'},{name:'topic',current:false,commit:'commit'}],history:[{hash:'commit',shortHash:'commit',subject:'Subject',author:'Author',authoredAt:'now'}],metadataLoading:false,metadataError:null,commitFiles:{commit:'commit',files:[{path:'historical',previousPath:null,kind:'modified'}],total:2},commitFilesLoading:false,remoteStatus:{branch:'main',upstream:'origin/main',ahead:1,behind:1},stashes:[{reference:'stash@{0}',message:'stash'}],operationBusy:false,reviewBusy:false,canRequestReview:true,draft:{commitMessage:'message',branchDraft:'new-branch',gitSection:'history',selectedCommit:'commit'},preview:{fileDiff:null,loading:false,error:null,selectedPath:null,staged:false,contextLabel:null}};
const context={workspaceId:'w',sessionId:'s',revision:4};
test('Git exposes complete action targets while trust, scope and busy state reject unavailable writes',()=>{
 const actions=gitActions(state);const ops=actions.map(a=>a.operation);
 for(const op of ['commit','stageFile','unstageFile','stageAll','unstageAll','createBranch','checkoutBranch','openDiff','selectCommit','loadMoreCommitFiles','openCommitDiff','fetch','pull','push','saveStash','applyStash','requestReview'])assert.ok(ops.includes(op),op);
 assert.deepEqual(actions.filter(a=>a.operation==='stageFile').map(a=>a.args),[['changed']]);
 assert.deepEqual(actions.filter(a=>a.operation==='unstageFile').map(a=>a.args),[['staged']]);
 assert.deepEqual(actions.filter(a=>a.operation==='checkoutBranch').map(a=>a.args),[['topic']]);
 const writes=['commit','stageFile','unstageFile','stageAll','unstageAll','createBranch','checkoutBranch','pull','push','saveStash','applyStash'];
 for(const denied of [{...state,workspace:{...state.workspace,trust:'untrusted'}},{...state,operationBusy:true},{...state,changes:{...state.changes,workspaceId:'other'}}])for(const action of gitActions(denied))assert.ok(!writes.includes(action.operation),action.operation);
 assert.ok(!gitActions({...state,draft:{...state.draft,selectedCommit:'other'}}).some(a=>a.operation==='openCommitDiff'));
});
test('Git tokens bind immutable operation arguments and revoke previous draft submissions and workspace inputs',()=>{
 const dir=createGitDirectory();const actions=dir.project(state);const commit=actions.find(a=>a.operation==='commit');
 const message={id:commit.token,event:'click',value:'forged message',context};
 assert.deepEqual(dir.resolve(state,context,message).args,['message']);
 assert.equal(dir.resolve({...state,draft:{...state.draft,commitMessage:'changed'}},context,message),null);
 assert.equal(dir.resolve(state,context,{...message,context:{...context,revision:3}}),null);
 assert.equal(dir.resolve(state,context,{...message,id:'git:invented'}),null);
 const input=actions.find(a=>a.operation==='commitMessage');const edit={id:input.token,event:'input',value:'new',context:{...context,revision:3}};
 assert.equal(dir.resolve(state,context,edit).operation,'commitMessage');
 dir.project({...state,workspace:{...state.workspace,id:'other'}});dir.project(state);
 assert.equal(dir.resolve(state,context,edit),null);
 const stage=dir.project(state).find(a=>a.operation==='stageFile');
 assert.equal(dir.resolve({...state,changes:{...state.changes,files:[]}},context,{id:stage.token,event:'click',context}),null);
});
