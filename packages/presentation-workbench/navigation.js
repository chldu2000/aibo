import {node,button,field,text} from './tree.js';
const labels={toggleSearch:'搜索会话',toggleFilter:'筛选会话',applyFilters:'应用筛选',addWorkspace:'添加工作区',toggleSessionCreator:'新建会话',toggleTrust:'更改信任',removeWorkspace:'移除工作区',openWorkspace:'打开目录',createCodex:'新建 Codex 会话',createPi:'新建 Pi 会话',unarchiveSession:'取消归档',archiveSession:'归档',syncSession:'同步',renameSession:'重命名',saveRename:'保存名称',cancelRename:'取消重命名'};
const states={active:'未归档',all:'全部',archived:'已归档',created:'已创建',starting:'启动中',running:'运行中',waiting_approval:'等待审批',waiting_user:'等待回答',compacting:'压缩中',idle:'空闲',interrupted:'已中断',failed:'失败',closed:'已关闭'};
export function renderNavigation(state,actions){
 const find=(operation,targetId)=>actions.find(action=>action.operation===operation&&action.targetId===targetId);
 const buttons=(operations,targetId)=>operations.flatMap(operation=>{const action=find(operation,targetId);return action?[button('navigation:'+operation+':'+(targetId??''),labels[operation],action)]:[]});
 const children=[node('h2','navigation:title','工作区'),node('nav','navigation:tools',null,buttons(['addWorkspace','toggleFilter']))];
 if(state.sessionFilterOpen){const action=find('filter');children.push(node('label','navigation:filter-label',null,[text('navigation:filter-text','会话状态'),{...node('select','navigation:filter',null,(action?.options??[]).map(value=>node('option','navigation:filter:'+value,states[value]??value,[],{value,selected:state.sessionFilter===value})),{'aria-label':'会话状态',value:state.sessionFilter}),...(action?{events:{change:action.token}}:{})}]),...buttons(['applyFilters']));}
 for(const workspace of state.workspaces){
  const expanded=state.expandedWorkspaceIds.includes(workspace.id);
  const rows=[button('workspace:'+workspace.id,workspace.label,find('selectWorkspace',workspace.id),{'aria-expanded':String(expanded),'aria-current':state.selectedWorkspaceId===workspace.id?'page':'false',title:workspace.path}),text('workspace:trust:'+workspace.id,workspace.trust==='trusted'?'已信任':'未信任'),node('nav','workspace:tools:'+workspace.id,null,buttons(['toggleSessionCreator','openWorkspace','toggleTrust','removeWorkspace'],workspace.id))];
  if(state.createSessionWorkspaceId===workspace.id)rows.push(node('nav','workspace:create:'+workspace.id,null,(state.agentChoices??[]).map(choice=>{
   const key='workspace:create:'+workspace.id+':'+choice.id;
   const action=actions.find(action=>action.operation==='createAgent'&&action.targetId===workspace.id&&action.choiceId===choice.id);
   const control=button(key,null,action,{'aria-label':'使用 '+choice.label+' 创建会话',title:choice.label});
   control.children=[node('svg',key+':icon',null,[node('path',key+':path',null,[],{d:choice.icon?.path??'M12 2 22 12 12 22 2 12Z',fill:'currentColor'})],{viewBox:'0 0 24 24',width:'16',height:'16','aria-hidden':'true'}),node('span',key+':label',choice.label)];
   return control;
  })));
  if(expanded){
   if(state.sessionsLoadingWorkspaceIds.includes(workspace.id))rows.push(node('p','workspace:loading:'+workspace.id,'正在加载会话',[],{role:'status'}));
   for(const session of state.sessionsByWorkspace[workspace.id]??[]){
    const parts=[button('session:'+session.id,session.label,find('selectSession',session.id),{'aria-current':state.selectedSessionId===session.id?'page':'false'}),text('session:state:'+session.id,`${session.agent} · ${states[session.state]??session.state}${session.archived?' · 已归档':''}`),node('nav','session:tools:'+session.id,null,buttons(['syncSession','renameSession','archiveSession','unarchiveSession'],session.id))];
    if(state.renamingSessionId===session.id)parts.push(field('session:rename:'+session.id,'会话名称',state.sessionLabelDraft,find('renameDraft',session.id)),...buttons(['saveRename','cancelRename'],session.id));
    rows.push(node('article','session:row:'+session.id,null,parts));
   }
  }
  children.push(node('section','workspace:section:'+workspace.id,null,rows));
 }
 return {...node('aside','navigation',null,children,{'aria-label':'工作区与会话'}),className:'navigation'};
}
