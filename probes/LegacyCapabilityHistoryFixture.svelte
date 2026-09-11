<script lang="ts">
  import { onMount } from 'svelte';
  import Panel from '../src/lib/components/app/CapabilityHistoryPanel.svelte';
  import { createCapabilityHistoryController, emptyCapabilityHistory } from '../src/lib/app/capability-history-controller';
  import { setUiKit, activeUiKitName, activeThemeStyle } from '../src/lib/ui-kit/registry';
  let state = $state(emptyCapabilityHistory());
  const scope = {kind:'workspace',id:'deleted-workspace'};
  const rows = Array.from({length:55},(_,index)=>({sequence:String(55-index),payload:{type:'legacy_snapshot',schemaVersion:'legacy-snapshot/1.0',invocationId:`old-${55-index}`,capability:'fixture.old-read',status:'completed',startedAt:'2026-01-01T00:00:00Z',finishedAt:null}}));
  const reads = [];
  const controller = createCapabilityHistoryController({
    list: async (_before,source) => ({schema:'aibo.capability-history-scopes/v1',source,items:source==='legacy'?[{scope,label:null}]:[],nextBefore:null}),
    read: async (scope,before,source) => { reads.push({scope,before,source});const remaining=rows.filter(row=>before===null||Number(row.sequence)<Number(before));const events=remaining.slice(0,50);return {schema:'aibo.capability-history-events/v1',source,scope,events,nextBefore:remaining.length>50?events.at(-1).sequence:null}; },
    publish: value => state=value,
  });
  onMount(()=>{window.legacyHistoryProbe={kit:setUiKit,reads:()=>reads};void controller.open();return ()=>{controller.close();delete window.legacyHistoryProbe;};});
</script>
<div data-ui-kit={$activeUiKitName} style={$activeThemeStyle}>
<Panel {state} desktop={true} onSource={source=>void controller.selectSource(source)} onSelect={scope=>void controller.select(scope)} onReload={()=>void controller.open()} onMoreScopes={()=>void controller.moreScopes()} onRefresh={()=>void controller.refresh()} onOlder={()=>void controller.older()} onNewer={()=>void controller.newer()} onLatest={()=>void controller.latest()} onBack={()=>{}} />
</div>
