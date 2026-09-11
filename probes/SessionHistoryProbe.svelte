<script lang="ts">
  import { onMount } from 'svelte';
  import Panel from '../src/lib/components/app/SessionHistoryPanel.svelte';
  import { createSessionHistoryController, emptySessionHistory } from '../src/lib/app/session-history-controller';
  import type { Session } from '../src/lib/types';
  const sessions:Session[] = ['current','old'].map(id=>({id,workspaceId:'w',agent:'unavailable.agent',label:id==='old'?'旧会话':'当前会话',archived:id==='old',state:'closed',externalSessionId:null,pluginInstallationId:'disabled',capabilities:[],createdAt:'2026-09-12T00:00:00Z',updatedAt:'2026-09-12T00:00:00Z'}));
  let state=$state(emptySessionHistory());
  const controller=createSessionHistoryController({
    list:async()=>sessions,
    read:async(workspaceId,id,before)=>{
      const end=before?Number(before.sequence):121,start=Math.max(0,end-50);
      return {schema:'aibo.session-history-page/v1',source:'persisted-core',session:sessions.find(session=>session.id===id)!,
        items:Array.from({length:end-start},(_,index)=>({id:`${id}-${start+index}`,sessionId:id,turnId:null,externalMessageId:null,role:'assistant',toolName:null,entryType:null,content:`${id} 保存消息 ${start+index}`,status:'completed',createdAt:'2026-09-12T00:00:00Z',updatedAt:'2026-09-12T00:00:00Z'})),
        nextBefore:start?{schema:'aibo.session-history-cursor/v1',workspaceId,sessionId:id,createdAt:'2026-09-12T00:00:00Z',sequence:String(start),id:`${id}-${start}`}:null};
    },publish:value=>{state=value;},
  });
  onMount(()=>{void controller.open('w');return()=>controller.close();});
</script>
<Panel workspaces={[{id:'w',label:'Fixture workspace'}]} workspaceId="w" {state} desktop={true} onWorkspace={()=>{}}
  onSession={id=>void controller.select(id)} onRefresh={()=>void controller.refresh()} onOlder={()=>void controller.older()}
  onNewer={()=>void controller.newer()} onLatest={()=>void controller.latest()} onReload={()=>void controller.open('w')} onClose={()=>{}} />
