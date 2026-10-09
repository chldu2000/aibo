import {presentationTranslator} from './i18n.js';
import {formatNumber} from './i18n.generated.js';
import {splitMessageAttachments} from './message-attachments.js';
import {node,button,field,section,text,actionFor} from './tree.js';
import {renderExecutionProfile,renderMessageAttachment,renderSessionMetadata} from './metadata.js';
import {splitSessionReferences} from './session-references.js';
import {renderTimeline} from './timeline.js';
export function renderConversation(state,actions,locale='zh-CN'){
 const t=presentationTranslator(locale);
 const labels={pauseGoal:t('goal.pause'),resumeGoal:t('goal.resume'),clearGoal:t('goal.clear'),send:t('composer.send'),stop:t('history.stop'),retry:t('app.retry'),queueSteer:t('composer.sendNow'),queueFollowUp:t('composer.queue'),clearQueue:t('external.clearQueue'),resumeQueue:t('queue.resume'),addAttachments:t('external.addAttachments'),addDirectory:t('composer.addFolder'),loadOlder:t('external.loadOlderMessages'),fork:t('external.forkSession'),loadModels:t('external.refreshModels'),compact:t('commands.compact'),openTree:t('tree.title'),closeTree:t('tree.close'),refreshTree:t('external.refreshTree'),submitAnswers:t('input.submit'),cancelAnswers:t('external.cancelAnswers')};
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const controls=(operations)=>operations.flatMap(operation=>{const action=actions.find(a=>a.operation===operation&&!a.args.length);return action?[button('conversation:action:'+operation,labels[operation],action)]:[]});
 const children=[node('header','conversation:header',null,[node('h1','conversation:title',state.session?.label??t('external.selectSession')),text('conversation:activity',state.activityLabel),node('nav','conversation:tools',null,controls(['fork','compact','openTree']))])];
 if(state.session?.historyOnly)children.push(text('conversation:history-only',t('composer.historyOnly')));
 children.push(renderSessionMetadata(state.session,'conversation:session-metadata',locale));
 const messages=renderTimeline(state.timelineVisibleCount>0?state.timeline.slice(-state.timelineVisibleCount):[],actions,state.groupSystemItems===true,state.attachments,locale);
 children.push({...node('section','conversation:timeline',null,[...controls(['loadOlder']),...messages],{'aria-label':t('external.sessionMessages')}),className:'timeline'});
 if(state.retryReason||state.retryPrompt)children.push(section('conversation:retry',t('app.retry'),[text('retry:reason',state.retryReason),text('retry:prompt',state.retryPrompt),...controls(['retry'])]));
 for(const request of state.userInputRequests){
  const questions=request.questions.map(question=>{
   const prefix='question:'+request.requestId+':'+question.id;
   const value=state.answerDrafts[JSON.stringify([request.sessionId,request.requestId,question.id,request.turnId])]??'';
   const options=question.options.map(option=>{
    const action=find('chooseAnswer',request.requestId,question.id,option.label);
    return button(prefix+':option:'+option.label,option.label,action,{'aria-pressed':String(value===option.label),title:option.description??option.label});
   });
   return section(prefix,question.header??question.question,[question.header?text(prefix+':prompt',question.question):null,...options,(question.isOther||!question.options.length)?field(prefix+':answer',question.question,value,find('answer',request.requestId,question.id),true):null]);
  });
  children.push(section('request:'+request.requestId,t('external.needAnswers'),[...questions,...['submitAnswers','cancelAnswers'].map(operation=>{const action=find(operation,request.requestId);return action?button('request:'+request.requestId+':'+operation,labels[operation],action):null;})]));
 }
 for(const request of (state.approvalRequests??[]).filter(request=>request.sessionId===state.session?.id)){
  const prefix='approval:'+request.requestId;
  // Reject kinds come first, matching the default workbench; decisions answer providers without options.
  const choices=request.options.length?[...request.options].sort((a,b)=>a.kind===b.kind?0:a.kind==='reject'?-1:1).map(option=>['option',option.id,option.label??(option.kind==='allow'?t('approval.allow'):t('approval.reject'))]):request.availableDecisions.map(decision=>['decision',decision,decision==='accept'?t('approval.allow'):t('approval.reject')]);
  children.push(section(prefix,t('approval.required'),[text(prefix+':kind',request.kind),request.command?text(prefix+':command',request.command):null,request.cwd?text(prefix+':cwd',request.cwd):null,
   ...choices.map(([kind,value,label])=>{const action=find('resolveApproval',request.requestId,kind,value);return action?button(prefix+':'+kind+':'+value,label,action):null;})]));
 }
 if(state.queue && (state.queue.items?.length || state.queue.steering.length || state.queue.followUp.length))children.push(section('conversation:queue',t('external.pendingMessages'),[
  state.queue.paused?text('queue:paused',t('queue.paused')):null,
  ...(state.queue.items?.length?state.queue.items.map(item=>section('queue:item:'+item.id,item.status==='sending'?t('external.sendingMessage'):item.status==='uncertain'?t('external.deliveryUnknown'):item.status==='failed'?t('queue.failed'):t('external.waitingToSend'),[
   text('queue:text:'+item.id,splitSessionReferences(item.text).body.split('[AIBO_CONTEXT_ATTACHMENTS]')[0].trim()),
   ...splitMessageAttachments(item.text,state.attachments).attachments.map(attachment=>renderMessageAttachment(attachment,'queue:'+item.id+':attachment:'+attachment.id)),
   item.error?text('queue:error:'+item.id,item.error):null,
   (!state.running || state.session?.capabilities.includes('queue.steer')) ? button('queue:send:'+item.id,t('composer.sendNow'),find('sendQueuedMessage',item.id)) : null,
   button('queue:remove:'+item.id,t('git.deleted'),find('removeQueuedMessage',item.id)),
  ])):[...state.queue.steering.map((value,i)=>text('queue:steer:'+i,t('external.steeringMessage',{text:value}))),...state.queue.followUp.map((value,i)=>text('queue:follow:'+i,t('external.followUpMessage',{text:value})))]),
  ...controls(['resumeQueue','clearQueue'])]));
 if(state.session){
  const draftField=field('conversation:draft',t('external.message'),state.draft,find('draft'),true);
  const submit=find(state.running?'queueFollowUp':'send');
  draftField.children[1].submitOnEnter=true;
  if(submit)draftField.children[1].primaryEnter=submit.token;
  const goal = state.goal && state.goal.status !== 'cleared' ? {...node('details','conversation:goal',null,[
   node('summary','goal:summary',state.goal.objective),
   text('goal:status',state.goal.status === 'active' ? (state.running ? t('goal.status.activeRunning') : t('goal.status.activeIdle')) : state.goal.status === 'paused' && state.running ? t('goal.status.pausedRunning') : ({paused:t('goal.status.paused'),completed:t('goal.status.completed'),blocked:t('goal.status.blocked'),usageLimited:t('goal.status.usageLimited'),budgetLimited:t('goal.status.budgetLimited')})[state.goal.status] ?? t('goal.status.unknown')),
   text('goal:budget',state.goal.tokenBudget == null ? null : t('external.goalBudget',{used:formatNumber(locale,state.goal.tokensUsed??0),budget:formatNumber(locale,state.goal.tokenBudget)})),
   ...controls(['pauseGoal','resumeGoal','clearGoal']),
  ],{open:true,'aria-label':t('goal.current')}),className:'goal-bar'} : null;
  const composer=[goal,draftField,text('conversation:shortcut',t('external.composerShortcut',{action:state.running?t('composer.queue'):t('composer.send')})),state.draftFailed?node('p','conversation:draft-error',t('external.draftSaveFailed'),[],{role:'alert'}):null];

  composer.push(node('nav','conversation:composer-tools',null,controls(['addAttachments','addDirectory','send','stop','queueSteer','queueFollowUp'])));
  const pendingAttachments=state.attachments.filter(item=>item.turnId===null && item.sessionId===state.session.id);
  const attachmentList=node('ul','conversation:attachment-list',null,pendingAttachments.map(item=>node('li','attachment:'+item.id,null,[renderMessageAttachment(item,'composer:attachment:'+item.id),button('attachment:remove:'+item.id,t('external.removeAttachment',{name:item.displayName??item.path}),find('removeAttachment',item.id))])));
  if(pendingAttachments.length)composer.push(node('details','conversation:attachments',null,[node('summary','conversation:attachments:summary',t('external.attachmentsCount',{count:pendingAttachments.length})),attachmentList],{open:true}));
  const mention=/(?:^|\s)@[^\s]*$/.test(state.draft);
  const slash=state.draft.match(/^\/([^\s]*)$/);
  const categoryOf=command=>command.category??(command.source==='skill'?'skill':command.source==='extension'||command.source==='prompt'?'extension':'agent');
  const matches=slash?state.agentCommands.filter(command=>command.enabled!==false&&[command.name,...(command.aliases??[]),command.description??''].join(' ').toLocaleLowerCase().includes(slash[1].toLocaleLowerCase())):state.agentCommands;
  const groups=slash?['all','agent','skill','extension'].map(id=>[id,t('composer.category.'+id)]).map(([id,label])=>({id,label,commands:matches.filter(command=>id==='all'||categoryOf(command)===id)})):[];
  const commands=slash?[...new Map(groups.flatMap(group=>group.commands).map(command=>[command.name,command])).values()]:matches;
  const pathButtons=state.workspacePathSuggestions.slice(0,24).map(item=>button('path:'+item.path,item.path+(item.isDirectory?'/':''),find('selectPath',item.path),{role:'option'}));
  const commandButtons=commands.map(command=>button('command:'+command.name,'/'+command.name,find('selectCommand',command.name),{title:command.description??command.name,role:slash?'option':'button'}));
  const sessionButtons=(state.sessionSuggestions??[]).map(item=>button('session-reference:'+item.id,t('external.sessionSuggestion',{label:item.label,agent:item.agent,archived:item.archived?t('external.archivedSuffix'):''}),find('selectSessionReference',item.id),{role:'option'}));
  const mentionGroups=mention?['all','files','folders','sessions'].map(id=>[id,t('composer.category.'+id)]).map(([id,label])=>({id,label,buttons:id==='sessions'?sessionButtons:id==='files'?pathButtons.filter((_,index)=>!state.workspacePathSuggestions[index].isDirectory):id==='folders'?pathButtons.filter((_,index)=>state.workspacePathSuggestions[index].isDirectory):[...sessionButtons,...pathButtons]})) : [];
  const mentionButtons=mention?[...new Map(mentionGroups.flatMap(group=>group.buttons).map(item=>[item.key,item])).values()]:[];
  if(mention)composer.push(node('div','conversation:mentions',null,[node('div','mentions:categories',null,mentionGroups.map(group=>node('button','mentions:category:'+group.id,group.label+' ('+group.buttons.length+')',[],{type:'button','aria-pressed':String(group.id==='all')})),{role:'group','aria-label':t('composer.referenceCategories')}),node('div','conversation:mention-options',null,mentionButtons,{role:'listbox','aria-label':t('composer.referenceSuggestions')})],{role:'group','aria-label':t('external.mentionCompletion')}));
  if(slash||state.agentCommands.length)composer.push(slash?node('div','conversation:commands',null,[node('div','commands:categories',null,groups.map(group=>node('button','commands:category:'+group.id,group.label+' ('+group.commands.length+')',[],{type:'button','aria-pressed':String(group.id==='all')})),{role:'group','aria-label':t('composer.commandCategories')}),node('div','conversation:command-options',null,commandButtons,{role:'listbox','aria-label':t('composer.commandSuggestions')})],{role:'group','aria-label':t('external.commandCompletion')}):node('details','conversation:commands',null,[node('summary','commands:title',t('inspector.command')),...commandButtons]));
  const suggestionButtons=mention?mentionButtons:slash?commandButtons:[];
  if(suggestionButtons.length||mention||slash&&groups.length)draftField.children[1].suggestions={listKey:mention?'conversation:mentions':'conversation:commands',keys:suggestionButtons.filter(button=>button.events?.click).map(button=>button.key),confirmWithTab:false,confirmWithPrimary:mention,...(mention?{categories:mentionGroups.map(group=>({key:'mentions:category:'+group.id,options:group.buttons.filter(button=>button.events?.click).map(button=>button.key)}))}:slash?{categories:groups.map(group=>({key:'commands:category:'+group.id,options:group.commands.filter(command=>find('selectCommand',command.name)).map(command=>'command:'+command.name)}))}:{})};
  const matrixModels=(state.modelCatalog?.models??[]).map(model=>section('model:'+model.reference,model.label,[text('model:description:'+model.reference,model.description),button('model:default:'+model.reference,t('external.defaultReasoning'),find('selectModel',model.reference,null),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&!state.modelConfiguration.selectedReasoningEffort)}),...model.reasoningEfforts.map(effort=>button('model:effort:'+model.reference+':'+effort.id,effort.label,find('selectModel',model.reference,effort.id),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&state.modelConfiguration.selectedReasoningEffort===effort.id),title:effort.description??effort.label}))]));
 const sequential=state.modelCatalog?.parameterScope==='current-model';
 const currentModel=state.modelCatalog?.current;
 const currentEfforts=currentModel?.reasoningEfforts??[];
 const selectedEffort=currentEfforts.find(option=>option.id===state.modelConfiguration.currentReasoningEffort);
 const models=sequential?[
   section('models:selection',t('composer.model'),(state.modelCatalog?.models??[]).map(model=>button('model:select:'+model.reference,model.label,find('selectModel',model.reference,null),{'aria-pressed':String(currentModel?.reference===model.reference),title:model.description??model.label}))),
   section('models:reasoning',t('composer.reasoning'),currentEfforts.length?currentEfforts.map(effort=>button('model:effort:'+currentModel.reference+':'+effort.id,effort.label,find('selectModel',currentModel.reference,effort.id),{'aria-pressed':String(state.modelConfiguration.selectedReasoningEffort===effort.id),title:effort.description??effort.label})):[text('models:no-reasoning',state.modelCatalogLoading?t('composer.updating'):t('composer.noReasoning'))]),
 ]:matrixModels;
  const fastTier=state.modelCatalog?.current?.serviceTiers?.find(tier=>tier.label?.trim().toLowerCase()==='fast');
  const fastAction=fastTier?find('selectServiceTier',state.modelCatalog?.currentServiceTier===fastTier.id?'default':fastTier.id):null;
  const contextAction=actions.find(action=>action.operation==='selectContextWindow');
  const contextOptions=state.modelCatalog?.current?.contextWindows??[];
  const contextCurrent=state.modelCatalog?.currentContextWindow;
  const contextKnown=contextOptions.some(option=>option.id===contextCurrent);
  const contextSelect=node('label','models:context-label',null,[text('models:context-title',t('side.context')),{
    ...node('select','models:context',null,[...(!contextKnown?[node('option','models:context:unknown',contextOptions.length?t('context.noCurrent'):t('context.unsupported'),[],{value:'',disabled:true,selected:true})]:[]),...contextOptions.map(option=>node('option','models:context:'+option.id,option.label,[],{value:option.id,selected:option.id===contextCurrent}))],{'aria-label':t('context.size'),disabled:!contextAction,value:contextKnown?contextCurrent:''}),
    ...(contextAction?{events:{change:contextAction.token}}:{}),
  }]);
  composer.push(node('details','conversation:models' ,null,[node('summary','models:title',(currentModel?.label??t('composer.model'))+(selectedEffort?' · '+selectedEffort.label:'')),...controls(['loadModels']),fastAction?button('models:fast','⚡ '+fastTier.label,fastAction,{'aria-pressed':String(state.modelCatalog?.currentServiceTier===fastTier.id),title:fastTier.description??fastTier.label}):null,contextSelect,state.modelCatalogLoading?text('models:loading',t('external.loadingModels')):null,...models]));
  composer.push(node('details','conversation:access',null,[node('summary','access:title',t('composer.sessionSettings')),...actions.filter(a=>a.operation==='selectAccess').map(action=>button('access:'+action.args[0],state.executionProfile?.sessionControls?.find(option=>option.id===action.args[0])?.label??action.args[0],action)),renderExecutionProfile(state.executionProfile,'conversation:execution-profile',locale)]));
  if(state.usage){
   const usage=state.usage;
   const percent=usage.contextUsed!==null&&usage.contextLimit?Math.min(100,Math.round(usage.contextUsed/usage.contextLimit*100)):null;
   const limits=[...(usage.limits??[]),...(usage.unknownLimits??[]).map(limit=>({...limit,usedPercent:null}))].map(limit=>t('external.quotaLine',{label:limit.label??(limit.windowMinutes?t('external.minutes',{count:limit.windowMinutes}):t('usage.plan')),amount:limit.usedPercent===null?t('usage.unknownQuota'):t('external.quotaRemaining',{percent:Math.max(0,100-Math.round(limit.usedPercent))}),observation:limit.observedAt!==undefined?t(limit.resetsAt===null?'external.lastObservedUnknownReset':'external.lastObserved'):''}));
   const credits=usage.credits?.unlimited?t('usage.unlimitedCredits'):usage.credits?.balance?'Credits '+usage.credits.balance:null;
   composer.push(node('p','conversation:usage',[percent===null?usage.contextUsed===null?null:t('external.contextTokens',{count:formatNumber(locale,usage.contextUsed)}):t('external.contextPercent',{percent,estimated:usage.contextEstimated?t('usage.estimatedDetail'):''}),usage.total===null?null:'Token '+usage.total,usage.plan?.toUpperCase(),...limits,credits].filter(Boolean).join(' · '),[],{'aria-label':t('usage.accessibility')}));
  }
  children.push(section('conversation:composer',t('external.composeMessage'),composer));
 }
 if(state.treeOpen){
  const branch=nodes=>nodes.map(item=>node('li','tree:'+item.id,null,[button('tree:select:'+item.id,item.label??item.summary??item.type,find('selectTreeNode',item.id),{'aria-current':state.tree?.leafId===item.id?'true':'false'}),node('ul','tree:children:'+item.id,null,branch(item.children))]));
  children.push(section('conversation:tree',t('tree.title'),[...controls(['closeTree','refreshTree']),text('tree:status',state.treeNavigationStatus),node('ul','tree:roots',null,branch(state.tree?.tree??[]))]));
 }
 const composer=children.find(child=>child?.key==='conversation:composer');
 const history={...node('section','conversation:history',null,children.filter(child=>child?.key!=='conversation:composer'),{'aria-label':t('search.sessionHistory'),tabindex:'0'}),className:'conversation-history'};
 return {...node('main','conversation',null,[history,composer],{'aria-label':t('scope.session')}),className:'conversation'};
}
