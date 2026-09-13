import type { PresentationCapabilityWorkbench, PresentationCapabilityAction } from '../../../packages/plugin-protocol/src/presentation-capability';
import type { PresentationContext, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import { actionMessage } from '../presentation/actions.ts';
import { createActionDirectory } from './action-directory.ts';
type Spec=Omit<PresentationCapabilityAction,'token'>;
export function capabilityWorkbenchActions(state:PresentationCapabilityWorkbench):Spec[]{
  const actions:Spec[]=[];
  const add=(operation:Spec['operation'],args:Spec['args']=[])=>actions.push({operation,args,event:'click'});
  for(const contribution of state.catalog)if(contribution.available)add('open',[contribution.installationId,contribution.contributionId]);
  if(!state.selected)return actions;
  add('close');
  if(state.view.restoring)return actions;
  add('reload');add('toggleLayout');
  const snapshot=state.view.snapshot;
  if(!snapshot||!['ready','empty'].includes(snapshot.state.status))return actions;
  if(snapshot.view.kind==='detail')add('toggleReading');
  for(const action of snapshot.actions) {
    if(!action.enabled)continue;
    const ids=action.id==='inspect'||action.id==='open-diff' ? snapshot.view.kind==='collection'?snapshot.view.items.map(item=>item.id):[]:[null];
    for(const id of ids)add('semantic',[JSON.stringify(actionMessage(snapshot,action.id,id))]);
  }
  return actions;
}
export function createCapabilityWorkbenchDirectory(){
  const directory=createActionDirectory<Spec>('capability');
  const scope=(state:PresentationCapabilityWorkbench)=>JSON.stringify([state.selected?.installationId,state.selected?.contributionId,state.scope]);
  return {
    project:(state:PresentationCapabilityWorkbench)=>directory.project(capabilityWorkbenchActions(state),scope(state)),
    resolve:(state:PresentationCapabilityWorkbench,context:PresentationContext,intent:PresentationIntent)=>directory.resolve(capabilityWorkbenchActions(state),scope(state),context,intent),
  };
}
