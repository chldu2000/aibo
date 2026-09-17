import {node,button,field,section,text,actionFor} from './tree.js';
import {renderExecutionProfile,renderAttachment,renderSessionMetadata} from './metadata.js';
import {splitSessionReferences} from './session-references.js';
import {renderTimeline} from './timeline.js';
const labels={pauseGoal:'暂停目标',resumeGoal:'恢复目标',clearGoal:'清除目标',send:'发送',stop:'停止',retry:'重试',queueSteer:'立即发送',queueFollowUp:'排队发送',clearQueue:'清空队列',resumeQueue:'继续队列',addAttachments:'添加附件',addDirectory:'添加目录',loadOlder:'加载更早消息',fork:'分叉会话',loadModels:'刷新模型',compact:'压缩上下文',openTree:'会话树',closeTree:'关闭会话树',refreshTree:'刷新会话树',submitAnswers:'提交回答',cancelAnswers:'取消回答'};
const accessLabels={'read-only':'只读',plan:'计划','workspace-write':'工作区写入','ask-for-approval':'请求审批','approve-for-me':'自动审批','full-access':'完整访问'};
export function renderConversation(state,actions){
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const controls=(operations)=>operations.flatMap(operation=>{const action=actions.find(a=>a.operation===operation&&!a.args.length);return action?[button('conversation:action:'+operation,labels[operation],action)]:[]});
 const children=[node('header','conversation:header',null,[node('h1','conversation:title',state.session?.label??'选择或创建会话'),text('conversation:activity',state.activityLabel),node('nav','conversation:tools',null,controls(['fork','compact','openTree']))])];
 children.push(renderSessionMetadata(state.session,'conversation:session-metadata'));
 const messages=renderTimeline(state.timelineVisibleCount>0?state.timeline.slice(-state.timelineVisibleCount):[],actions,state.groupSystemItems===true);
 children.push({...node('section','conversation:timeline',null,[...controls(['loadOlder']),...messages],{'aria-label':'会话消息'}),className:'timeline'});
 if(state.retryReason||state.retryPrompt)children.push(section('conversation:retry','重试',[text('retry:reason',state.retryReason),text('retry:prompt',state.retryPrompt),...controls(['retry'])]));
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
  children.push(section('request:'+request.requestId,'需要你的回答',[...questions,...['submitAnswers','cancelAnswers'].map(operation=>{const action=find(operation,request.requestId);return action?button('request:'+request.requestId+':'+operation,labels[operation],action):null;})]));
 }
 if(state.queue && (state.queue.items?.length || state.queue.steering.length || state.queue.followUp.length))children.push(section('conversation:queue','待处理消息',[
  state.queue.paused?text('queue:paused','自动发送已暂停'):null,
  ...(state.queue.items?.length?state.queue.items.map(item=>section('queue:item:'+item.id,item.status==='sending'?'正在发送':item.status==='uncertain'?'投递结果未知':item.status==='failed'?'发送失败':'等待发送',[
   text('queue:text:'+item.id,splitSessionReferences(item.text).body.split('[AIBO_CONTEXT_ATTACHMENTS]')[0].trim()),
   item.error?text('queue:error:'+item.id,item.error):null,
   (!state.running || state.session?.capabilities.includes('queue.steer')) ? button('queue:send:'+item.id,'立即发送',find('sendQueuedMessage',item.id)) : null,
   button('queue:remove:'+item.id,'删除',find('removeQueuedMessage',item.id)),
  ])):[...state.queue.steering.map((value,i)=>text('queue:steer:'+i,'引导：'+value)),...state.queue.followUp.map((value,i)=>text('queue:follow:'+i,'后续：'+value))]),
  ...controls(['resumeQueue','clearQueue'])]));
 if(state.session){
  const draftField=field('conversation:draft','消息',state.draft,find('draft'),true);
  const submit=find(state.running?'queueFollowUp':'send');
  if(submit)draftField.children[1].primaryEnter=submit.token;
  const goal = state.goal && state.goal.status !== 'cleared' ? {...node('details','conversation:goal',null,[
   node('summary','goal:summary',state.goal.objective),
   text('goal:status',state.goal.status === 'active' ? (state.running ? '目标进行中' : '目标待继续') : state.goal.status === 'paused' && state.running ? '目标已暂停，当前回合尚未结束' : ({paused:'目标已暂停',completed:'目标已完成',blocked:'目标受阻',usageLimited:'额度受限',budgetLimited:'目标预算已耗尽'})[state.goal.status] ?? '目标状态未知'),
   text('goal:budget',state.goal.tokenBudget == null ? null : `Token：${state.goal.tokensUsed??0} / ${state.goal.tokenBudget}`),
   ...controls(['pauseGoal','resumeGoal','clearGoal']),
  ],{open:true,'aria-label':'当前目标'}),className:'goal-bar'} : null;
  const composer=[goal,draftField,text('conversation:shortcut','⌘/Ctrl+Enter '+(state.running?'排队发送':'发送')+' · Enter 换行'),state.draftFailed?node('p','conversation:draft-error','草稿保存失败',[],{role:'alert'}):null];

  composer.push(node('nav','conversation:composer-tools',null,controls(['addAttachments','addDirectory','send','stop','queueSteer','queueFollowUp'])));
  const attachmentList=node('ul','conversation:attachment-list',null,state.attachments.map(item=>node('li','attachment:'+item.id,null,[renderAttachment(item,'composer:attachment:'+item.id),button('attachment:remove:'+item.id,'移除附件 '+item.path,find('removeAttachment',item.id))])));
  if(state.attachments.length)composer.push(node('details','conversation:attachments',null,[node('summary','conversation:attachments:summary','附件 · '+state.attachments.length),attachmentList]));
  const mention=/(?:^|\s)@[^\s]*$/.test(state.draft);
  const slash=state.draft.match(/^\/([^\s]*)$/);
  const categoryOf=command=>command.category??(command.source==='skill'?'skill':command.source==='extension'||command.source==='prompt'?'extension':'agent');
  const matches=slash?state.agentCommands.filter(command=>command.enabled!==false&&[command.name,...(command.aliases??[]),command.description??''].join(' ').toLocaleLowerCase().includes(slash[1].toLocaleLowerCase())):state.agentCommands;
  const groups=slash?[['all','All'],['agent','Agent'],['skill','Skills'],['extension','Extension']].map(([id,label])=>({id,label,commands:matches.filter(command=>id==='all'||categoryOf(command)===id).slice(0,24)})):[];
  const commands=slash?[...new Map(groups.flatMap(group=>group.commands).map(command=>[command.name,command])).values()]:matches;
  const pathButtons=state.workspacePathSuggestions.slice(0,24).map(item=>button('path:'+item.path,item.path+(item.isDirectory?'/':''),find('selectPath',item.path),{role:'option'}));
  const commandButtons=commands.map(command=>button('command:'+command.name,'/'+command.name,find('selectCommand',command.name),{title:command.description??command.name,role:slash?'option':'button'}));
  const sessionButtons=(state.sessionSuggestions??[]).map(item=>button('session-reference:'+item.id,'会话 · '+item.label+' · '+item.agent+(item.archived?' · 已归档':''),find('selectSessionReference',item.id),{role:'option'}));
  const mentionGroups=mention?[['all','All'],['files','Files'],['folders','Folders'],['sessions','Sessions']].map(([id,label])=>({id,label,buttons:id==='sessions'?sessionButtons:id==='files'?pathButtons.filter((_,index)=>!state.workspacePathSuggestions[index].isDirectory):id==='folders'?pathButtons.filter((_,index)=>state.workspacePathSuggestions[index].isDirectory):[...sessionButtons,...pathButtons]})) : [];
  const mentionButtons=mention?[...new Map(mentionGroups.flatMap(group=>group.buttons).map(item=>[item.key,item])).values()]:[];
  if(mention)composer.push(node('div','conversation:mentions',null,[node('div','mentions:categories',null,mentionGroups.map(group=>node('button','mentions:category:'+group.id,group.label+' ('+group.buttons.length+')',[],{type:'button','aria-pressed':String(group.id==='all')})),{role:'group','aria-label':'引用分类'}),node('div','conversation:mention-options',null,mentionButtons,{role:'listbox','aria-label':'引用建议'})],{role:'group','aria-label':'引用补全'}));
  if(slash||state.agentCommands.length)composer.push(slash?node('div','conversation:commands',null,[node('div','commands:categories',null,groups.map(group=>node('button','commands:category:'+group.id,group.label+' ('+group.commands.length+')',[],{type:'button','aria-pressed':String(group.id==='all')})),{role:'group','aria-label':'命令分类'}),node('div','conversation:command-options',null,commandButtons,{role:'listbox','aria-label':'命令建议'})],{role:'group','aria-label':'命令补全'}):node('details','conversation:commands',null,[node('summary','commands:title','命令'),...commandButtons]));
  const suggestionButtons=mention?mentionButtons:slash?commandButtons:[];
  if(suggestionButtons.length||mention||slash&&groups.length)draftField.children[1].suggestions={listKey:mention?'conversation:mentions':'conversation:commands',keys:suggestionButtons.filter(button=>button.events?.click).map(button=>button.key),confirmWithTab:false,confirmWithPrimary:mention,...(mention?{categories:mentionGroups.map(group=>({key:'mentions:category:'+group.id,options:group.buttons.filter(button=>button.events?.click).map(button=>button.key)}))}:slash?{categories:groups.map(group=>({key:'commands:category:'+group.id,options:group.commands.filter(command=>find('selectCommand',command.name)).map(command=>'command:'+command.name)}))}:{})};
  const models=(state.modelCatalog?.models??[]).map(model=>section('model:'+model.reference,model.label,[text('model:description:'+model.reference,model.description),button('model:default:'+model.reference,'默认推理强度',find('selectModel',model.reference,null),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&!state.modelConfiguration.selectedReasoningEffort)}),...model.reasoningEfforts.map(effort=>button('model:effort:'+model.reference+':'+effort.id,effort.label,find('selectModel',model.reference,effort.id),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&state.modelConfiguration.selectedReasoningEffort===effort.id),title:effort.description??effort.label}))]));
  const fastTier=state.modelCatalog?.current?.serviceTiers?.find(tier=>tier.label?.trim().toLowerCase()==='fast');
  const fastAction=fastTier?find('selectServiceTier',state.modelCatalog?.currentServiceTier===fastTier.id?'default':fastTier.id):null;
  const contextAction=actions.find(action=>action.operation==='selectContextWindow');
  const contextOptions=state.modelCatalog?.current?.contextWindows??[];
  const contextCurrent=state.modelCatalog?.currentContextWindow;
  const contextKnown=contextOptions.some(option=>option.id===contextCurrent);
  const contextSelect=node('label','models:context-label',null,[text('models:context-title','上下文'),{
    ...node('select','models:context',null,[...(!contextKnown?[node('option','models:context:unknown',contextOptions.length?'未提供当前值':'不支持',[],{value:'',disabled:true,selected:true})]:[]),...contextOptions.map(option=>node('option','models:context:'+option.id,option.label,[],{value:option.id,selected:option.id===contextCurrent}))],{'aria-label':'模型上下文大小',disabled:!contextAction,value:contextKnown?contextCurrent:''}),
    ...(contextAction?{events:{change:contextAction.token}}:{}),
  }]);
  composer.push(node('details','conversation:models' ,null,[node('summary','models:title',state.modelCatalog?.current?.label??'模型'),...controls(['loadModels']),fastAction?button('models:fast','⚡ '+fastTier.label,fastAction,{'aria-pressed':String(state.modelCatalog?.currentServiceTier===fastTier.id),title:fastTier.description??fastTier.label}):null,contextSelect,state.modelCatalogLoading?text('models:loading','正在加载模型'):null,...models]));
  composer.push(node('details','conversation:access',null,[node('summary','access:title','访问权限'),...actions.filter(a=>a.operation==='selectAccess').map(action=>button('access:'+action.args[0],accessLabels[action.args[0]]??action.args[0],action)),renderExecutionProfile(state.executionProfile,'conversation:execution-profile')]));
  if(state.usage){
   const usage=state.usage;
   const percent=usage.contextUsed!==null&&usage.contextLimit?Math.min(100,Math.round(usage.contextUsed/usage.contextLimit*100)):null;
   const limits=(usage.limits??[]).map(limit=>(limit.label??(limit.windowMinutes?limit.windowMinutes+' 分钟':'套餐'))+'剩余 '+Math.max(0,100-Math.round(limit.usedPercent))+'%');
   const credits=usage.credits?.unlimited?'Credits 不限量':usage.credits?.balance?'Credits '+usage.credits.balance:null;
   composer.push(node('p','conversation:usage',[percent===null?usage.contextUsed===null?null:'上下文 '+usage.contextUsed:'上下文 '+percent+'%'+(usage.contextEstimated?'（估算）':''),usage.total===null?null:'Token '+usage.total,usage.plan?.toUpperCase(),...limits,credits].filter(Boolean).join(' · '),[],{'aria-label':'会话用量与套餐余量'}));
  }
  children.push(section('conversation:composer','撰写消息',composer));
 }
 if(state.treeOpen){
  const branch=nodes=>nodes.map(item=>node('li','tree:'+item.id,null,[button('tree:select:'+item.id,item.label??item.summary??item.type,find('selectTreeNode',item.id),{'aria-current':state.tree?.leafId===item.id?'true':'false'}),node('ul','tree:children:'+item.id,null,branch(item.children))]));
  children.push(section('conversation:tree','会话树',[...controls(['closeTree','refreshTree']),text('tree:status',state.treeNavigationStatus),node('ul','tree:roots',null,branch(state.tree?.tree??[]))]));
 }
 const composer=children.find(child=>child?.key==='conversation:composer');
 const history={...node('section','conversation:history',null,children.filter(child=>child?.key!=='conversation:composer'),{'aria-label':'会话历史',tabindex:'0'}),className:'conversation-history'};
 return {...node('main','conversation',null,[history,composer],{'aria-label':'会话'}),className:'conversation'};
}
