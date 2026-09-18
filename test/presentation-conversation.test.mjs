import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationActions, createConversationDirectory } from '../src/lib/presentation-runtime/conversation.ts';
import { userInputDraftKey, answeredRequest, clearRequestDrafts } from '../src/lib/app/user-input-drafts.ts';
import { renderConversation } from '../packages/presentation-workbench/conversation.js';
const request = {requestId:'request',sessionId:'s',turnId:'t',questions:[{id:'q',question:'Choice?',header:null,options:[{label:'Yes',description:null}],isOther:true}],isBlocking:true};
const state = {
 workspace:{id:'w',label:'Workspace',path:'/workspace',trust:'trusted'},session:{id:'s',workspaceId:'w',agent:'plugin',label:'Session',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'installed',capabilities:['queue.manage','queue.steer','model.select','model.reasoning','session.fork','session.tree','compaction.run'],createdAt:'',updatedAt:''},
 goal:null,thread:null,timeline:[{id:'m',turnId:'t',role:'assistant',toolName:null,entryType:null,content:'complete',status:'completed'}],timelineVisibleCount:0,usage:null,retryPrompt:'retry',retryReason:null,userInputRequests:[request],answerDrafts:{},queue:{sessionId:'s',steering:['later'],followUp:[],updatedAt:''},activityLabel:null,compacting:false,running:false,archiving:false,busy:false,
 attachments:[{id:'pending',sessionId:'s',turnId:null},{id:'submitted',sessionId:'s',turnId:'t'},{id:'other',sessionId:'elsewhere',turnId:null}],executionProfile:{sessionId:"s",accessModes:["read-only","plan","workspace-write"],requested:{interactionMode:"ask",approvalPolicy:"never",approvalReviewer:"none",filesystemPolicy:"read-only",commandPolicy:"disabled",networkPolicy:"disabled"},enforced:{interactionMode:"ask",approvalPolicy:"never",approvalReviewer:"none",filesystemPolicy:"read-only",commandPolicy:"disabled",networkPolicy:"disabled"},unsupported:[],adapterCapabilities:[],nativeSandbox:false},modelConfiguration:{currentReasoningEffort:null,selectedReasoningEffort:null,defaultAction:'preserve'},modelCatalog:{current:null,currentReasoningEffort:null,reasoningEfforts:[],models:[{reference:'model',reasoningEfforts:[{id:'high'}]}]},modelCatalogLoading:false,modelOverride:null,workspacePathSuggestions:[{path:'README.md',isDirectory:false}],agentCommands:[{name:'help',enabled:true},{name:'disabled',enabled:false}],agentCommandsLoading:false,draft:'draft',draftFailed:false,tree:{sessionId:'s',tree:[{id:'node',children:[]}]},treeOpen:true,treeNavigationStatus:null,
};
const context={workspaceId:'w',sessionId:'s',revision:5};
const operations=s=>conversationActions(s).map(action=>action.operation);
test('conversation directory covers data-dependent operations without fabricating capability permissions',()=>{
 const actions=conversationActions(state);
 for(const operation of ['send','draft','retry','addAttachments','addDirectory','loadOlder','fork','compact','selectModel','loadModels','selectAccess','answer','chooseAnswer','openTree','selectTreeNode'])assert.ok(operations(state).includes(operation),operation);
 assert.deepEqual(actions.filter(a=>a.operation==='removeAttachment').map(a=>a.args),[['pending']]);
 assert.deepEqual(actions.filter(a=>a.operation==='selectCommand').map(a=>a.args),[['help']]);
 assert.deepEqual(actions.filter(a=>a.operation==='selectModel').map(a=>a.args),[['model',null],['model','high']]);
 const historical={...state,session:{...state.session,pluginInstallationId:null}};
 assert.deepEqual(operations(historical),['loadOlder']);
 assert.ok(!operations({...state,session:{...state.session,capabilities:[]}}).includes('compact'));
 const active={...state,running:true};
 for(const operation of ['send','selectModel','fork','selectAccess','compact'])assert.ok(!operations(active).includes(operation),operation);
 for(const operation of ['draft','queueSteer','queueFollowUp','clearQueue','stop'])assert.ok(operations(active).includes(operation),operation);
 assert.ok(!operations({...active,session:{...state.session,capabilities:[]}}).includes('draft'));
 assert.ok(!operations({...state,busy:true}).includes('send'));
});
test('presentation plugins render usage inside the composer with optional quota facts',()=>{
 const usage={input:1200,output:34,total:1234,contextUsed:1200,contextLimit:10000,contextEstimated:true,plan:'plus',limits:[{id:'primary',label:'5 小时',usedPercent:20,windowMinutes:300,resetsAt:null}],credits:{balance:'12.5',unlimited:false}};
 const tree=renderConversation({...state,usage},[]);
 const composer=tree.children.find(child=>child.key==='conversation:composer');
 const row=composer.children.find(child=>child.key==='conversation:usage');
 assert.match(row.text,/上下文 12%/);
 assert.match(row.text,/PLUS/);
 assert.match(row.text,/5 小时剩余 80%/);
 assert.match(row.text,/Credits 12.5/);
});
test('Codex priority service tier is presented as the Fast action',()=>{
 const fastState={...state,
  session:{...state.session,capabilities:[...state.session.capabilities,'model.service-tier']},
  modelCatalog:{current:{reference:'gpt-6-astra',label:'GPT-6-Astra',serviceTiers:[{id:'priority',label:'Fast',description:'2x speed'}]},currentServiceTier:null,currentReasoningEffort:null,reasoningEfforts:[],models:[]}};
 const action=conversationActions(fastState).find(candidate=>candidate.operation==='selectServiceTier');
 assert.deepEqual(action?.args,['priority']);
 const models=renderConversation(fastState,[action]).children.find(child=>child.key==='conversation:composer').children.find(child=>child.key==='conversation:models');
 assert.ok(models.children.some(child=>child.key==='models:fast'&&child.text==='⚡ Fast'));
});
test('opaque conversation tokens retain live input but retire across removals and session reentry',()=>{
 const directory=createConversationDirectory();const first=directory.project(state);const draft=first.find(a=>a.operation==='draft');
 const message={id:draft.token,event:'input',value:'new',context:{...context,revision:4}};
 assert.equal(directory.resolve(state,context,message).operation,'draft');
 assert.equal(directory.resolve(state,context,{...message,context:{...context,revision:6}}),null);
 assert.equal(directory.resolve(state,context,{...message,event:'click'}),null);
 const send=first.find(a=>a.operation==='send');
 assert.equal(directory.resolve(state,context,{...message,id:send.token,event:'click'}),null);
 assert.equal(directory.resolve({...state,busy:true},context,{...message,id:send.token,event:'click',context}),null);
 assert.equal(directory.resolve(state,context,{...message,id:'conversation:invented'}),null);
 directory.project({...state,busy:true});directory.project(state);
 assert.equal(directory.resolve(state,context,message),null);
 const second=directory.project(state).find(a=>a.operation==='draft');
 directory.project({...state,session:{...state.session,id:'other'}});directory.project(state);
 assert.equal(directory.resolve(state,context,{...message,id:second.token}),null);
 const choice=directory.project(state).find(a=>a.operation==='chooseAnswer');
 assert.deepEqual(directory.resolve(state,context,{id:choice.token,event:'click',value:'forged',context}).args,['request','q','Yes','t']);
});
test('host answer drafts preserve independent sessions and only clear the completed request',()=>{
 const other={...request,sessionId:'other'};
 const drafts={[userInputDraftKey(request,'q')]:' Yes ',[userInputDraftKey(other,'q')]:'Keep'};
 assert.deepEqual(answeredRequest(request,drafts),{q:['Yes']});
 assert.equal(answeredRequest(request,{}),null);
 assert.deepEqual(clearRequestDrafts(request,drafts),{[userInputDraftKey(other,'q')]:'Keep'});
 const directory=createConversationDirectory();const token=directory.project({...state,answerDrafts:drafts}).find(a=>a.operation==='submitAnswers').token;
 assert.equal(directory.resolve(state,context,{id:token,event:'click',context}),null);
 const answer=directory.project(state).find(a=>a.operation==='answer');
 assert.equal(directory.resolve({...state,userInputRequests:[{...request,turnId:'new-turn'}]},context,{id:answer.token,event:'input',value:'late',context}),null);
 assert.equal(directory.resolve({...state,userInputRequests:[]},context,{id:answer.token,event:'input',value:'late',context}),null);
});

test('session reference actions reject foreign sessions and retire after selection or navigation',()=>{
 const candidate={...state.session,id:'source',archived:true};
 const referencing={...state,draft:'@',sessionSuggestions:[candidate,{...candidate,id:'foreign',workspaceId:'elsewhere'},state.session]};
 const directory=createConversationDirectory();
 const actions=directory.project(referencing).filter(a=>a.operation==='selectSessionReference');
 assert.deepEqual(actions.map(a=>a.args),[['source']]);
 const intent={id:actions[0].token,event:'click',context};
 assert.equal(directory.resolve({...referencing,sessionSuggestions:[]},context,intent),null);
 assert.equal(directory.resolve({...referencing,busy:true},context,intent),null);
});

test('goals remain above the draft and distinguish idle goals from executing turns', () => {
 const goalState = {...state, session:{...state.session,capabilities:['goal.manage']},goal:{objective:'Finish the migration',status:'active',tokenBudget:2000,tokensUsed:100}};
 const actions = conversationActions(goalState);
 assert.ok(actions.some(action => action.operation === 'clearGoal'));
 assert.ok(!conversationActions({...goalState,running:true}).some(action => action.operation === 'clearGoal'));
 assert.ok(!conversationActions({...goalState,session:{...goalState.session,capabilities:[]}}).some(action => action.operation === 'clearGoal'));
 const tree = renderConversation(goalState,actions);
 const composer = tree.children.find(child => child.key === 'conversation:composer');
 const goal = composer.children.find(child => child.key === 'conversation:goal');
 assert.ok(composer.children.indexOf(goal) < composer.children.findIndex(child => child.key === 'conversation:draft'));
 assert.equal(goal.children.find(child => child.key === 'goal:status').text,'目标待继续');
 assert.equal(tree.children[0].children.some(child => child.key === 'conversation:goal'),false);
 for (const [status,label] of [['paused','目标已暂停'],['completed','目标已完成'],['blocked','目标受阻']]) {
  const rendered = renderConversation({...goalState,goal:{...goalState.goal,status}},actions).children.find(child => child.key === 'conversation:composer');
  assert.equal(rendered.children.find(child => child.key === 'conversation:goal').children.find(child => child.key === 'goal:status').text,label);
 }
});

test('goal pause and resume actions depend on capability, goal status and live execution', () => {
 const goalState={...state,session:{...state.session,capabilities:['goal.manage','goal.pause','goal.resume']},goal:{objective:'Finish',status:'active',tokenBudget:2000,tokensUsed:100}};
 const goalActions=value=>operations(value).filter(op=>['clearGoal','pauseGoal','resumeGoal'].includes(op));
 assert.deepEqual(goalActions({...goalState,running:true}),['pauseGoal']);
 assert.deepEqual(goalActions({...goalState,goal:{...goalState.goal,status:'paused'}}),['resumeGoal','clearGoal']);
 assert.deepEqual(goalActions({...goalState,goalBusy:true}),[]);
 assert.deepEqual(goalActions({...goalState,session:{...goalState.session,archived:true}}),[]);
 assert.deepEqual(goalActions({...goalState,session:{...goalState.session,capabilities:['goal.manage']}}),['clearGoal']);
 for (const status of ['completed','budgetLimited','unknown']) assert.deepEqual(goalActions({...goalState,goal:{...goalState.goal,status}}),['clearGoal']);
 const directory=createConversationDirectory();
 const action=directory.project(goalState).find(action=>action.operation==='resumeGoal');
 assert.equal(directory.resolve({...goalState,running:true},context,{id:action.token,event:'click',context}),null,'an idle resume token cannot restart a running goal');
});


test('context window dropdown is capability gated and rejects stale or invented selection intents', () => {
  const model = { reference: 'model', serviceTiers: [], contextWindows: [{ id: 'standard', label: '128K' }, { id: 'long', label: '1M' }] };
  const configured = { ...state, session: { ...state.session, capabilities: [...state.session.capabilities, 'model.context-window'] }, modelCatalog: { ...state.modelCatalog, current: model, currentContextWindow: 'standard' } };
  const directory = createConversationDirectory();
  const actions = directory.project(configured);
  const action = actions.find(action => action.operation === 'selectContextWindow');
  assert.equal(action.event, 'change');
  const intent = { id: action.token, event: 'change', value: 'long', context };
  assert.ok(directory.resolve(configured, context, intent));
  assert.equal(directory.resolve(configured, context, { ...intent, value: 'invented' }), null);
  assert.equal(directory.resolve(configured, context, { ...intent, context: { ...context, revision: 4 } }), null);
  const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
  const select = flatten(renderConversation(configured, actions)).find(node => node.key === 'models:context');
  assert.equal(select.tag, 'select'); assert.equal(select.attrs.disabled, false);
  assert.equal(select.events.change, action.token);
  assert.deepEqual(select.children.map(option => option.text), ['128K', '1M']);
  for (const changed of [{ ...configured, running: true }, { ...configured, busy: true }, { ...configured, modelCatalogLoading: true }, { ...configured, session: { ...configured.session, capabilities: [] } }, { ...configured, modelCatalog: { ...configured.modelCatalog, current: { ...model, reference: 'different' } } }]) {
    assert.equal(directory.resolve(changed, context, intent), null);
  }
  const unsupported = { ...configured, session: { ...configured.session, capabilities: [] } };
  const disabled = flatten(renderConversation(unsupported, conversationActions(unsupported))).find(node => node.key === 'models:context');
  assert.equal(disabled.attrs.disabled, true); assert.equal(disabled.events, undefined);
});

test('access actions use host-authorized modes and never infer authority from an agent name', () => {
  for (const agent of ['codex','pi','external.agent']) {
    const session={...state.session,agent};
    const modes=value=>conversationActions(value).filter(action=>action.operation==='selectAccess').map(action=>action.args[0]);
    assert.deepEqual(modes({...state,session,executionProfile:null}),[]);
    assert.deepEqual(modes({...state,session,executionProfile:{...state.executionProfile,sessionId:'other'}}),[]);
    assert.deepEqual(modes({...state,session,executionProfile:{...state.executionProfile,accessModes:['read-only']}}),['read-only']);
    assert.deepEqual(modes({...state,session,executionProfile:{...state.executionProfile,accessModes:['ask-for-approval','full-access']}}),['ask-for-approval','full-access']);
  }
});
