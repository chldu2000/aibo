import {presentationTranslator} from './i18n.js';
import {node,button,field,text} from './tree.js';
export function renderNavigation(state,actions,locale='zh-CN'){
 const t=presentationTranslator(locale);
 const labels={toggleSearch:t('external.searchSessions'),toggleFilter:t('sidebar.filter'),applyFilters:t('external.applyFilters'),addWorkspace:t('sidebar.addWorkspace'),toggleSessionCreator:t('search.newSession'),toggleTrust:t('external.changeTrust'),removeWorkspace:t('sidebar.removeWorkspace'),openWorkspace:t('external.openDirectory'),unarchiveSession:t('sidebar.unarchive'),archiveSession:t('sidebar.archiveHint'),syncSession:t('external.sync'),renameSession:t('external.rename'),saveRename:t('external.saveName'),cancelRename:t('external.cancelRename')};
 const states={active:t('external.unarchived'),all:t('composer.category.all'),archived:t('session.status.archived'),created:t('external.created'),starting:t('session.status.starting'),running:t('subagent.status.running'),waiting_approval:t('external.awaitApproval'),waiting_user:t('external.awaitAnswer'),compacting:t('session.status.compacting'),idle:t('session.status.idle'),interrupted:t('timeline.interrupted'),failed:t('timeline.failed'),closed:t('subagent.status.closed')};
 const find=(operation,targetId)=>actions.find(action=>action.operation===operation&&action.targetId===targetId);
 const buttons=(operations,targetId)=>operations.flatMap(operation=>{const action=find(operation,targetId);return action?[button('navigation:'+operation+':'+(targetId??''),labels[operation],action)]:[]});
 const children=[node('h2','navigation:title',t('external.workspaces')),node('nav','navigation:tools',null,buttons(['addWorkspace','toggleFilter']))];
 if(state.sessionFilterOpen){const action=find('filter');children.push(node('label','navigation:filter-label',null,[text('navigation:filter-text',t('external.sessionState')),{...node('select','navigation:filter',null,(action?.options??[]).map(value=>node('option','navigation:filter:'+value,states[value]??value,[],{value,selected:state.sessionFilter===value})),{'aria-label':t('external.sessionState'),value:state.sessionFilter}),...(action?{events:{change:action.token}}:{})}]),...buttons(['applyFilters']));}
 for(const workspace of state.workspaces){
  const expanded=state.expandedWorkspaceIds.includes(workspace.id);
  const rows=[button('workspace:'+workspace.id,workspace.label,find('selectWorkspace',workspace.id),{'aria-expanded':String(expanded),'aria-current':state.selectedWorkspaceId===workspace.id?'page':'false',title:workspace.path}),text('workspace:trust:'+workspace.id,workspace.trust==='trusted'?t('external.trusted'):t('external.untrusted')),node('nav','workspace:tools:'+workspace.id,null,buttons(['toggleSessionCreator','openWorkspace','toggleTrust','removeWorkspace'],workspace.id))];
  if(state.createSessionWorkspaceId===workspace.id)rows.push(node('nav','workspace:create:'+workspace.id,null,(state.agentChoices??[]).map(choice=>{
   const key='workspace:create:'+workspace.id+':'+choice.id;
   const action=actions.find(action=>action.operation==='createAgent'&&action.targetId===workspace.id&&action.choiceId===choice.id);
   const control=button(key,null,action,{'aria-label':t('external.createWithAgent',{name:choice.label}),title:choice.label});
   control.children=[node('svg',key+':icon',null,[node('path',key+':path',null,[],{d:choice.icon?.path??'M12 2 22 12 12 22 2 12Z',fill:'currentColor'})],{viewBox:'0 0 24 24',width:'16',height:'16','aria-hidden':'true'}),node('span',key+':label',choice.label)];
   return control;
  })));
  if(expanded){
   if(state.sessionsLoadingWorkspaceIds.includes(workspace.id))rows.push(node('p','workspace:loading:'+workspace.id,t('external.loadingSessions'),[],{role:'status'}));
   for(const session of state.sessionsByWorkspace[workspace.id]??[]){
    const parts=[button('session:'+session.id,session.label,find('selectSession',session.id),{'aria-current':state.selectedSessionId===session.id?'page':'false'}),text('session:state:'+session.id,t('external.sessionStateLine',{agent:session.agent,state:states[session.state]??session.state,archived:session.archived?t('external.archivedSuffix'):''})),node('nav','session:tools:'+session.id,null,buttons(['syncSession','renameSession','archiveSession','unarchiveSession'],session.id))];
    if(state.renamingSessionId===session.id)parts.push(field('session:rename:'+session.id,t('sidebar.sessionName'),state.sessionLabelDraft,find('renameDraft',session.id)),...buttons(['saveRename','cancelRename'],session.id));
    rows.push(node('article','session:row:'+session.id,null,parts));
   }
  }
  children.push(node('section','workspace:section:'+workspace.id,null,rows));
 }
 return {...node('aside','navigation',null,children,{'aria-label':t('sidebar.browse')}),className:'navigation'};
}
