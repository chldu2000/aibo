<script lang="ts">
  import { AgentSettingsForm } from '../src/lib/ui-kit';
  import { createAgentSettingsController, type AgentSettingsState } from '../src/lib/app/agent-settings-controller';
  import type { AgentSettingsSnapshot } from '../packages/plugin-protocol/src/settings';
  let state = $state<AgentSettingsState>({target:null,snapshot:null,draft:{},loading:false,saving:false,error:null,notice:null});
  let saved: AgentSettingsSnapshot = {
    target:{installationId:'probe',contributionId:'dev.probe.agent',scope:{kind:'application'}},
    descriptor:{schema:'aibo.agent-settings/v1',version:1,title:'Agent 设置',scopes:['application'],fields:[
      {key:'text',label:'名称',type:'text',default:'Default'},
      {key:'instructions',label:'附加指令',type:'multiline',default:''},
      {key:'enabled',label:'附带摘要',type:'boolean',default:true},
      {key:'limit',label:'结果数量',type:'number',default:10,min:1,max:100},
      {key:'length',label:'回答长度',type:'select',default:'normal',options:[{value:'normal',label:'正常'},{value:'brief',label:'简短'}]},
    ]},
    revision:0,values:{},inheritedValues:{text:'Default',instructions:'',enabled:true,limit:10,length:'normal'},effectiveValues:{text:'Default',instructions:'',enabled:true,limit:10,length:'normal'},
  };
  const probe = {fail:false,saves:[] as unknown[]};
  const controller = createAgentSettingsController({
    read:async()=>structuredClone(saved),
    save:async request=>{
      if (probe.fail) throw Error('settings_conflict: 配置已被其他窗口修改');
      probe.saves.push(request);
      saved={...saved,revision:saved.revision+1,values:request.values,effectiveValues:{...saved.inheritedValues,...request.values}};
      return structuredClone(saved);
    },
    changed:value=>state=value,
  });
  (window as unknown as {settingsProbe:typeof probe}).settingsProbe=probe;
  void controller.select(saved.target);
</script>
{#if state.snapshot}
  <AgentSettingsForm snapshot={state.snapshot} draft={state.draft} busy={state.loading || state.saving} error={state.error} notice={state.notice} onChange={controller.change} onSave={() => void controller.save()} onReset={controller.reset} onReload={() => void controller.reload()} />
{/if}
