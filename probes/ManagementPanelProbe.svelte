<script lang="ts">
  import { ManagementCenter, Button } from '../src/lib/ui-kit';
  import type { UiManagementSection } from '../src/lib/ui-kit';
  import ManagementPanel from '../src/lib/components/app/ManagementPanel.svelte';
  import { managementPanels, createManagementSettingsStore, settingsTargetKey } from '../src/lib/app/management-panels';
  import type { AgentSettingsState } from '../src/lib/app/agent-settings-controller';
  import type { AgentSettingsTarget } from '../packages/plugin-protocol/src/settings';
  import fixture from '../fixtures/plugins/management-panel/manifest.json';
  const panel = managementPanels([{id:'example',installed:true,enabled:false,contributions:fixture.contributions.map(metadata => ({kind:metadata.kind,metadata}))}])[0];
  let active = $state<UiManagementSection>('appearance');
  let states = $state<Record<string,AgentSettingsState>>({});
  const targets: AgentSettingsTarget[] = panel.declaration.sections[0].settingsReferences.map(ref => ({installationId:'example',contributionId:ref.contributionId,scope:{kind:'application'}}));
  const saves: unknown[] = [];
  const snapshot = (target: AgentSettingsTarget) => ({target,descriptor:{schema:'aibo.agent-settings/v1' as const,version:1,title:target.contributionId.endsWith('secondary.agent')?'Second':'First',scopes:['application' as const],fields:[{key:'text',label:target.contributionId.endsWith('secondary.agent')?'Second instructions':'First instructions',type:'multiline' as const,default:''}]},revision:0,values:{},effectiveValues:{text:''},inheritedValues:{text:''}});
  const store=createManagementSettingsStore({read:async target=>snapshot(target),save:async request=>{
    saves.push(request);return {...snapshot(request),revision:1,values:request.values};
  },changed:value=>states=value});
  for(const target of targets)void store.controller(target).select(target);
  (window as unknown as {managementProbe: unknown}).managementProbe={saves};
</script>
{#snippet empty()}<p>Host settings</p>{/snippet}
{#snippet content()}
<ManagementPanel {panel} sectionId="behavior" scope="application" workspaceId={null} session={null}
  forms={targets.map(target=>({key:settingsTargetKey(target),target,state:states[settingsTargetKey(target)]}))}
  onSection={()=>{}} onScope={()=>{}} onChange={(target,key,value)=>store.controller(target).change(key,value)}
  onSave={target=>{void store.controller(target).save();}} onReset={target=>store.controller(target).reset()} onReload={target=>{void store.controller(target).reload();}} />
{/snippet}
<ManagementCenter title="Settings" activeSection={active} onSelectSection={section=>active=section} onClose={()=>{}}
 appearance={empty} layout={empty} workspace={empty} extensions={empty} runtime={empty}
 pluginPanels={[{id:panel.id,label:panel.declaration.title,description:'Plugin settings'}]} pluginPanel={content}/>
