import { createInstalledController, type InstalledContribution, type InstalledPort, type InstalledScope } from '../presentation/installed-controller.ts';
import type { ViewStateStore } from './view-state-storage';
import { actionMessage } from '../presentation/actions.ts';
import type { Snapshot, ActionMessage } from '../presentation/contract';

export type InstalledWorkbenchState = import('../../../packages/plugin-protocol/src/presentation-capability').PresentationCapabilityView;

export const emptyInstalledWorkbench = (): InstalledWorkbenchState => ({snapshot:null,error:'',enhanced:true,layout:'central',focusTarget:null,restoring:false});

/** Owns the capability lease and view preferences independently of a renderer instance. */
export function createInstalledWorkbenchController(port: InstalledPort, stateStore: ViewStateStore, publish: (state: InstalledWorkbenchState) => void) {
  let state = emptyInstalledWorkbench();
  let selection: {workspaceId:string;contribution:InstalledContribution;scope:InstalledScope} | null = null;
  let offset = 0, ticket = 0;
  let disposed = false;
  const changed = (patch: Partial<InstalledWorkbenchState>) => { state = {...state,...patch}; publish(state); };
  function storageScope() {
    const value = selection!;
    return {workspaceId:value.scope.kind==='application'?'application':value.scope.id,contributionId:`${value.contribution.contributionId}.${value.contribution.installationId}`};
  }
  function save() {
    if (selection && !state.restoring && state.snapshot && ['ready','empty'].includes(state.snapshot.state.status)) stateStore.write(storageScope(), {
      selection:state.focusTarget,detail:state.snapshot.view.kind==='detail'?state.snapshot.view.itemId:null,offset,layout:state.layout,
    });
  }
  const controller = createInstalledController(port,(snapshot,error)=>{
    if (disposed) return;
    if(snapshot?.view.kind==='collection'&&snapshot.state.status!=='loading') {
      offset=snapshot.view.page.offset;
      if(!snapshot.view.items.some(item=>item.id===state.focusTarget))state={...state,focusTarget:null};
      snapshot.view.selection=state.focusTarget;
    }
    changed({snapshot,error});save();
  });
  async function restore() {
    if(!selection||disposed)return;
    const current=++ticket, remembered=stateStore.read(storageScope());
    const {workspaceId,contribution,scope}=selection;
    changed({restoring:true,layout:remembered.layout,focusTarget:remembered.selection});
    await controller.open(workspaceId,contribution,scope);
    while(current===ticket&&!disposed) {
      const value=state.snapshot;
      if(!value||value.state.status!=='ready'||value.view.kind!=='collection'||value.view.page.offset>=remembered.offset||!value.actions.some(action=>action.id==='next'&&action.enabled))break;
      const before=value.view.page.offset;
      await controller.act(actionMessage(value,'next'));
      if(state.snapshot?.view.kind==='collection'&&state.snapshot.view.page.offset<=before)break;
    }
    if(current!==ticket||disposed)return;
    const value=state.snapshot;
    if(value?.view.kind==='collection') {
      const focusTarget=value.view.items.some(item=>item.id===remembered.selection)?remembered.selection:null;
      value.view.selection=focusTarget;changed({focusTarget});
      if(focusTarget&&remembered.detail===focusTarget)await controller.act(actionMessage(value,value.actions.find(action=>action.intent==='inspect')?.id??'inspect',focusTarget));
    }
    if(current===ticket&&!disposed){changed({restoring:false});save();}
  }
  return {
    async open(workspaceId:string,contribution:InstalledContribution,scope:InstalledScope={kind:'workspace',id:workspaceId}) {
      selection={workspaceId,contribution,scope};await restore();
    },
    reload:restore,
    async act(message:ActionMessage) {
      if(disposed||state.restoring||!state.snapshot||JSON.stringify(state.snapshot.context)!==JSON.stringify(message.context)||!state.snapshot.actions.some(action=>action.id===message.actionId&&action.enabled))return;
      try { actionMessage(state.snapshot,message.actionId,message.itemId); } catch { return; }
      if(message.actionId==='inspect'||message.actionId==='open-diff')changed({focusTarget:message.itemId});
      await controller.act(message);
    },
    toggleLayout(){if(!disposed){changed({layout:state.layout==='central'?'sidebar':'central'});save();}},
    toggleReading(){if(!disposed)changed({enhanced:!state.enhanced});},
    dispose(){if(disposed)return;disposed=true;++ticket;controller.dispose();},
  };
}
