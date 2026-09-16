<script lang="ts">
  import { SubagentCard, activeThemeStyle, appearanceSelection, setUiKit } from '$lib/ui-kit';
  import SubagentDetails from '$lib/components/app/SubagentDetails.svelte';
  import type { SubagentTask, SubagentEntry } from '$lib/app/subagents';
  import '../../src/app.css';
  const agent: SubagentTask = {id:'child',parentId:'parent',rootTurnId:'turn',name:'Reader',task:'检查事件链路并报告发现的问题。',status:'running',activity:'正在读取会话历史模块'};
  let open = $state(false);
  let entries = $state<SubagentEntry[]>(Array.from({length:24},(_,index)=>({id:String(index),role:'assistant',toolName:null,content:`工作记录 ${index + 1}\n\n已检查事件、状态和历史读取。`,status:'completed'})));
  Object.assign(window,{appendSubagentEntry:()=> { entries=[...entries,{id:'latest',role:'assistant',toolName:null,content:'最新收到的工作记录',status:'completed'}]; }});
</script>
<div class="app-shell" data-ui-kit={$appearanceSelection.kitId} style={$activeThemeStyle}>
  <main style="padding:32px; width: min(700px, 100%);">
    <button onclick={() => setUiKit('shadcn')}>shadcn</button><button onclick={() => setUiKit('material3')}>material3</button>
    <SubagentCard name={agent.name} task={agent.task} statusLabel="运行中" activity={agent.activity} failed={false} onOpen={() => open = true}/>
    <SubagentDetails {open} {agent} {entries} loading={false} error={null} onClose={() => open=false} onRetry={() => {}}/>
  </main>
</div>
