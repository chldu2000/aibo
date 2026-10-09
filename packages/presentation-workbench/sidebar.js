import {presentationTranslator} from './i18n.js';
import {node,button,actionFor} from './tree.js';
import {renderGit} from './git.js';
import {renderInspector} from './inspector.js';
/** External skins consume the same host tabs and leases. Placement may be adapted by the skin. */
export function renderSidebar(data,renderSemantic,locale){
 const state=data.sidebar,actions=data.sidebarActions??[],t=presentationTranslator(locale);
 const layout=operation=>actionFor(actions,'layout',JSON.stringify(operation));
 const add=node('details','sidebar:add',null,[node('summary','sidebar:add:title',t('sidebar.add')),...state.entries.map((entry,index)=>button('sidebar:add:'+index,entry.label,layout({kind:'open',target:JSON.parse(entry.value)})))]);
 const panes=state.layout.panes.map(pane=>{
  const tabs=node('nav','sidebar:tabs:'+pane.id,null,pane.tabs.map(id=>node('span','sidebar:tab:'+id,null,[button('sidebar:focus:'+id,state.titles[id]??id,layout({kind:'focus',tabId:id}),{role:'tab','aria-selected':String(id===pane.active)}),button('sidebar:close:'+id,'×',layout({kind:'close',tabId:id}),{'aria-label':t('sidebar.close',{title:state.titles[id]??id})})])));
  const id=pane.active,controls=[];
  if(id){
   controls.push(button('sidebar:split:'+id,t('sidebar.split'),layout({kind:'split',tabId:id})));
   if(pane.floating)controls.push(button('sidebar:dock:'+id,t('sidebar.dock'),layout({kind:'dock',tabId:id})));
   for(const other of state.layout.panes)if(other.id!==pane.id)controls.push(button('sidebar:move:'+id+':'+other.id,t('sidebar.move')+' '+(state.layout.panes.indexOf(other)+1),layout({kind:'move',tabId:id,paneId:other.id})));
  }
  let content=null;
  if(id==='git')content=renderGit(data.git,data.gitActions??[],locale);
  else if(id==='context')content=renderInspector(data.inspector,data.inspectorActions??[],locale);
  else if(id){
   const view=state.views[id],snapshot=view?.snapshot;
   const items=[node('p','sidebar:error:'+id,view?.error||(!view?t('sidebar.unavailable'):view.restoring?t('workbench.loading'):''))];
   items.push(button('sidebar:reload:'+id,t('workbench.reload'),actionFor(actions,'reload',id)));
   if(snapshot){
    const semanticActions=actions.filter(action=>action.operation==='semantic'&&action.args[0]===id).map(entry=>{const action=JSON.parse(entry.args[1]);return {token:entry.token,action,label:snapshot.actions.find(item=>item.id===action.actionId)?.label??action.actionId}});
    // Semantic renderers use snapshot-local keys; namespace each complete subtree for multiple live tabs.
    const tree=renderSemantic({snapshot,actions:semanticActions});
    const scope=node=>({...node,key:'sidebar:'+id+':'+node.key,...(node.children?{children:node.children.map(scope)}:{})});
    items.push(scope(tree));
   }
   content=node('section','sidebar:plugin:'+id,null,items);
  }
  return {...node('section','sidebar:pane:'+pane.id,null,[tabs,node('nav','sidebar:controls:'+pane.id,null,controls),content??node('p','sidebar:empty:'+pane.id,t('sidebar.empty'))]),className:'sidebar-pane'};
 });
 return node('div','sidebar',null,[add,...panes]);
}
