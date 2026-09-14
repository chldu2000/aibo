import type { CapabilityHistorySource, CapabilityHistoryEvents, CapabilityHistoryScope, CapabilityHistoryScopeItem, CapabilityHistoryScopes } from '../types';
import { toErrorMessage } from './error-utils';
export const capabilityScopeKey = (scope:CapabilityHistoryScope) => JSON.stringify([scope.kind,scope.kind==='application'?'application':scope.id]);
export const capabilityScopeLabel = (item:CapabilityHistoryScopeItem) => item.scope.kind==='application'?'应用':`${item.scope.kind==='workspace'?'工作区':'会话'} · ${item.label??item.scope.id}`;
export type CapabilityHistoryState = { source:CapabilityHistorySource; scopes:CapabilityHistoryScopeItem[]; nextScopes:string|null; selected:CapabilityHistoryScope|null; page:CapabilityHistoryEvents|null; pageNumber:number; loadingScopes:boolean; loadingEvents:boolean; error:string|null };
export const emptyCapabilityHistory = ():CapabilityHistoryState => ({source:'events',scopes:[],nextScopes:null,selected:null,page:null,pageNumber:1,loadingScopes:false,loadingEvents:false,error:null});
export function createCapabilityHistoryController(ports:{
  list(before:string|null,source:CapabilityHistorySource):Promise<CapabilityHistoryScopes>;
  read(scope:CapabilityHistoryScope,before:string|null,source:CapabilityHistorySource):Promise<CapabilityHistoryEvents>;
  publish(state:CapabilityHistoryState):void;
}) {
  type View={state:CapabilityHistoryState;revision:number;before:string|null;back:(string|null)[]};
  let current:View|undefined;
  const publish=(view:View)=>{if(current===view)ports.publish({...view.state});};
  async function read(view:View):Promise<void> {
    const scope=view.state.selected;if(!scope)return;
    const revision=++view.revision;view.state.loadingEvents=true;view.state.error=null;view.state.pageNumber=view.back.length+1;publish(view);
    try {
      const page=await ports.read(scope,view.before,view.state.source);
      if(current!==view||view.revision!==revision)return;
      if((page.source??'events')!==view.state.source||page.schema!=='aibo.capability-history-events/v1'||capabilityScopeKey(page.scope)!==capabilityScopeKey(scope))throw Error('调用记录与当前作用域不匹配');
      view.state.page=page;
    }catch(error){if(current===view&&view.revision===revision)view.state.error=toErrorMessage(error);}
    finally{if(current===view&&view.revision===revision){view.state.loadingEvents=false;publish(view);}}
  }
  async function list(view:View,before:string|null):Promise<void>{
    if(view.state.loadingScopes)return;
    view.state.loadingScopes=true;view.state.error=null;publish(view);
    try{
      const page=await ports.list(before,view.state.source);if(current!==view)return;
      if((page.source??'events')!==view.state.source||page.schema!=='aibo.capability-history-scopes/v1')throw Error('不支持的调用目录版本');
      const scopes=new Map(view.state.scopes.map(item=>[capabilityScopeKey(item.scope),item]));
      for(const item of page.items)scopes.set(capabilityScopeKey(item.scope),item);
      view.state.scopes=[...scopes.values()];view.state.nextScopes=page.nextBefore;
      if(!view.state.selected&&view.state.scopes.length){view.state.selected=view.state.scopes[0].scope;await read(view);}
    }catch(error){if(current===view)view.state.error=toErrorMessage(error);}
    finally{if(current===view){view.state.loadingScopes=false;publish(view);}}
  }
  function open(source:CapabilityHistorySource='events'):Promise<void>{const view:View={state:{...emptyCapabilityHistory(),source},revision:0,before:null,back:[]};current=view;publish(view);return list(view,null);}
  return {
    selectSource:open,
    close(){current=undefined;},
    open():Promise<void>{return open(current?.state.source??'events');},
    moreScopes():Promise<void>{const view=current;return view?.state.nextScopes?list(view,view.state.nextScopes):Promise.resolve();},
    select(scope:CapabilityHistoryScope):Promise<void>{const view=current;if(!view||!view.state.scopes.some(item=>capabilityScopeKey(item.scope)===capabilityScopeKey(scope)))return Promise.resolve();view.state.selected=scope;view.state.page=null;view.before=null;view.back=[];return read(view);},
    refresh():Promise<void>{return current?read(current):Promise.resolve();},
    older():Promise<void>{const view=current;const before=view?.state.page?.nextBefore;if(!view||!before||view.state.loadingEvents)return Promise.resolve();view.back.push(view.before);view.before=before;view.state.page=null;return read(view);},
    newer():Promise<void>{const view=current;if(!view||!view.back.length||view.state.loadingEvents)return Promise.resolve();view.before=view.back.pop()??null;view.state.page=null;return read(view);},
    latest():Promise<void>{const view=current;if(!view)return Promise.resolve();view.before=null;view.back=[];view.state.page=null;return read(view);},
  };
}
