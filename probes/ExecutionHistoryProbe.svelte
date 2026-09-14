<script lang="ts">
  import { onMount } from 'svelte';
  import Panel from '../src/lib/components/app/ExecutionHistoryPanel.svelte';
  import { createExecutionHistoryController, emptyExecutionHistory } from '../src/lib/app/execution-history-controller';
  import type { ExecutionCursor, ProjectActionRun, WorkspaceWriteRun } from '../src/lib/types';
  let state = $state(emptyExecutionHistory());
  let workspaceId = $state('first');
  function rows(kind: 'task' | 'git', workspaceId: string, before: ExecutionCursor | null) {
    return Array.from({length:21}, (_, index) => ({
      id: `record-${String(20-index).padStart(3,'0')}`, workspaceId, status:'completed', startedAt:'2026-09-12T00:00:00Z', completedAt:'2026-09-12T00:00:01Z',
    })).filter(row => !before || kind < before.kind || kind === before.kind && row.id < before.id);
  }
  const controller = createExecutionHistoryController({
    readTasks: async (workspaceId, before): Promise<ProjectActionRun[]> => rows('task',workspaceId,before).map(row => ({...row,schema:'aibo.project-action-run/v3',actionId:row.id,actionName:row.id,sessionId:null,exitCode:0,output:'Saved task result',artifactId:null})),
    readWrites: async (workspaceId, before): Promise<WorkspaceWriteRun[]> => rows('git',workspaceId,before).map(row => ({...row,status:'completed',schema:'aibo.workspace-write-run/v2',operation:'git.commit',snapshot:{schema:'aibo.workspace-write-intent/v1',origin:'host',workspaceId,workspacePath:'fixture',operation:'git.commit',input:{message:row.id}},result:{ok:true,output:{committed:true}},callerWindow:'main'})),
    cancelTask: async()=>false, cancelWrite:async()=>false, publish:value=>{state=value;},
  });
  function select(id: string) { workspaceId=id; controller.open(id,'main'); }
  onMount(()=>{ controller.open(workspaceId,'main'); return ()=>controller.close(); });
</script>
<Panel workspaces={[{id:'first',label:'First workspace'},{id:'second',label:'Second workspace'}]} {workspaceId} windowId="main" {state} desktop={true}
  onSelectWorkspace={select} onRefresh={()=>void controller.refresh()} onStop={key=>void controller.stop(key)} onClose={()=>{}}
  onOlder={()=>void controller.older()} onNewer={()=>void controller.newer()} onLatest={()=>void controller.latest()} />
