import {node,button,field,section,text,actionFor} from './tree.js';
import {renderExecutionProfile,renderAttachment,renderSessionMetadata} from './metadata.js';
import {renderTimelineEntry} from './timeline.js';
const labels={send:'发送',stop:'停止',retry:'重试',queueSteer:'立即引导',queueFollowUp:'排队发送',clearQueue:'清空队列',addAttachments:'添加附件',addDirectory:'添加目录',loadOlder:'加载更早消息',fork:'分叉会话',loadModels:'刷新模型',compact:'压缩上下文',openTree:'会话树',closeTree:'关闭会话树',refreshTree:'刷新会话树',submitAnswers:'提交回答',cancelAnswers:'取消回答'};
const accessLabels={'read-only':'只读',plan:'计划','workspace-write':'工作区写入','ask-for-approval':'请求审批','approve-for-me':'自动审批','full-access':'完整访问'};
export function renderConversation(state,actions){
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const controls=(operations)=>operations.flatMap(operation=>{const action=actions.find(a=>a.operation===operation&&!a.args.length);return action?[button('conversation:action:'+operation,labels[operation],action)]:[]});
 const children=[node('header','conversation:header',null,[node('h1','conversation:title',state.session?.label??'选择或创建会话'),text('conversation:activity',state.activityLabel),node('nav','conversation:tools',null,controls(['fork','compact','openTree']))])];
 children.push(renderSessionMetadata(state.session,'conversation:session-metadata'));
 if(state.goal)children.push(section('conversation:goal','目标',[text('goal:objective',state.goal.objective),text('goal:status',state.goal.status),text('goal:budget',state.goal.tokenBudget===null?null:`Token：${state.goal.tokensUsed??0} / ${state.goal.tokenBudget}`)]));
 if(state.usage)children.push(text('conversation:usage',`输入 ${state.usage.input??'—'} · 输出 ${state.usage.output??'—'} · 合计 ${state.usage.total??'—'} · 上下文 ${state.usage.contextUsed??'—'} / ${state.usage.contextLimit??'—'}${state.usage.contextEstimated?'（估算）':''}`));
 const messages=(state.timelineVisibleCount>0?state.timeline.slice(-state.timelineVisibleCount):[]).map(entry=>renderTimelineEntry(entry,actions));
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
 if(state.queue)children.push(section('conversation:queue','待处理消息',[...state.queue.steering.map((value,i)=>text('queue:steer:'+i,'引导：'+value)),...state.queue.followUp.map((value,i)=>text('queue:follow:'+i,'后续：'+value)),...controls(['clearQueue'])]));
 if(state.session){
  const composer=[field('conversation:draft','消息',state.draft,find('draft'),true),state.draftFailed?node('p','conversation:draft-error','草稿保存失败',[],{role:'alert'}):null];
  composer.push(node('ul','conversation:attachments',null,state.attachments.map(item=>node('li','attachment:'+item.id,null,[renderAttachment(item,'composer:attachment:'+item.id),button('attachment:remove:'+item.id,'移除附件 '+item.path,find('removeAttachment',item.id))]))));
  composer.push(node('nav','conversation:composer-tools',null,controls(['addAttachments','addDirectory','send','stop','queueSteer','queueFollowUp'])));
  if(state.workspacePathSuggestions.length)composer.push(section('conversation:paths','路径建议',state.workspacePathSuggestions.map(item=>button('path:'+item.path,item.path+(item.isDirectory?'/':''),find('selectPath',item.path)))));
  if(state.agentCommands.length)composer.push(node('details','conversation:commands',null,[node('summary','commands:title','命令'),...state.agentCommands.map(command=>button('command:'+command.name,'/'+command.name,find('selectCommand',command.name),{title:command.description??command.name}))]));
  const models=(state.modelCatalog?.models??[]).map(model=>section('model:'+model.reference,model.label,[text('model:description:'+model.reference,model.description),button('model:default:'+model.reference,'默认推理强度',find('selectModel',model.reference,null),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&!state.modelConfiguration.selectedReasoningEffort)}),...model.reasoningEfforts.map(effort=>button('model:effort:'+model.reference+':'+effort.id,effort.label,find('selectModel',model.reference,effort.id),{'aria-pressed':String(state.modelCatalog?.current?.reference===model.reference&&state.modelConfiguration.selectedReasoningEffort===effort.id),title:effort.description??effort.label}))]));
  composer.push(node('details','conversation:models',null,[node('summary','models:title',state.modelCatalog?.current?.label??'模型'),...controls(['loadModels']),state.modelCatalogLoading?text('models:loading','正在加载模型'):null,...models]));
  composer.push(node('details','conversation:access',null,[node('summary','access:title','访问权限'),...actions.filter(a=>a.operation==='selectAccess').map(action=>button('access:'+action.args[0],accessLabels[action.args[0]]??action.args[0],action)),renderExecutionProfile(state.executionProfile,'conversation:execution-profile')]));
  children.push(section('conversation:composer','撰写消息',composer));
 }
 if(state.treeOpen){
  const branch=nodes=>nodes.map(item=>node('li','tree:'+item.id,null,[button('tree:select:'+item.id,item.label??item.summary??item.type,find('selectTreeNode',item.id),{'aria-current':state.tree?.leafId===item.id?'true':'false'}),node('ul','tree:children:'+item.id,null,branch(item.children))]));
  children.push(section('conversation:tree','会话树',[...controls(['closeTree','refreshTree']),text('tree:status',state.treeNavigationStatus),node('ul','tree:roots',null,branch(state.tree?.tree??[]))]));
 }
 return {...node('main','conversation',null,children,{'aria-label':'会话'}),className:'conversation'};
}
