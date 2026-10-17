import type { ManagementData, ManagementReadTarget } from '../../../packages/plugin-protocol/src/management';
export type ManagementDataState = { target: ManagementReadTarget | null; data: ManagementData | null; loading: boolean; failed: boolean };
export const emptyManagementData = (): ManagementDataState => ({target:null,data:null,loading:false,failed:false});
/** Read results belong to the current view only; closed views never retain account data. */
export function createManagementDataController(ports: {read(target: ManagementReadTarget): Promise<ManagementData>; changed(state: ManagementDataState): void}) {
  let state = emptyManagementData();
  let generation = 0;
  const publish = (next: ManagementDataState) => {state=next;ports.changed(state);};
  async function refresh() {
    const target=state.target;
    const current=++generation;
    if (!target) return;
    publish({target,data:null,loading:true,failed:false});
    try { const data=await ports.read(target); if (current===generation) publish({target,data,loading:false,failed:false}); }
    catch { if (current===generation) publish({target,data:null,loading:false,failed:true}); }
  }
  return {refresh,select(target: ManagementReadTarget | null) {
    if (JSON.stringify(target)===JSON.stringify(state.target)) return;
    ++generation;publish({target,data:null,loading:false,failed:false});
    if (target) void refresh();
  }};
}
