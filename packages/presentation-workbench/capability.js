import {node,button,section,text,actionFor} from './tree.js';
/** The skin supplies its semantic renderer; only host-bound semantic actions are forwarded. */
export function renderCapability(state,actions,renderSemantic){
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const controls=[];
 for(const [operation,label] of [['close','关闭能力视图'],['reload','重新加载'],['toggleLayout','切换布局'],['toggleReading',state.view.enhanced?'使用通用阅读':'尝试专业阅读']]){const action=find(operation);if(action)controls.push(button('capability:'+operation,label,action));}
 const children=[node('nav','capability:catalog',null,state.catalog.map(item=>button('capability:open:'+item.installationId+':'+item.contributionId,item.title,find('open',item.installationId,item.contributionId),{title:item.issue??item.title})))];
 if(state.selected){
  children.push(node('h2','capability:selected-title',state.selected.title),node('nav','capability:controls',null,controls),text('capability:error',state.view.error),state.view.restoring?text('capability:restoring','正在恢复视图'):null);
  if(state.view.snapshot){
   const snapshot=state.view.snapshot;
   if(snapshot.view.kind==='detail'&&state.view.enhanced)children.push(node('p','capability:reading-fallback','专业阅读界面不可用，已使用通用视图。',[],{role:'status'}));
   const semanticActions=actions.filter(action=>action.operation==='semantic').map(entry=>{const action=JSON.parse(entry.args[0]);return {token:entry.token,action,label:snapshot.actions.find(item=>item.id===action.actionId)?.label??action.actionId};});
   children.push(renderSemantic({snapshot,actions:semanticActions}));
  }
 }
 return section('capability','能力视图',children);
}
