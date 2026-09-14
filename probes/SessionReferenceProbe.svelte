<script lang="ts">
  import Composer from '../src/lib/components/app/Composer.svelte';
  let text=$state('@');
  let selected=$state('');
  const source={id:'source',workspaceId:'w',label:'设计讨论',agent:'codex',state:'closed' as const,archived:true,externalSessionId:null,pluginInstallationId:null,capabilities:[],createdAt:'',updatedAt:''};
</script>
<div style="padding-top: 300px; width: 800px; margin: auto;">
<Composer selectedAgent="pi" selectedSession={true} selectedSessionId="target" sessionArchived={false} sessionRunning={false} selectedSessionArchiving={false} busy={false}
  attachments={[]} executionProfile={null} modelConfiguration={{currentReasoningEffort:null,selectedReasoningEffort:null,defaultAction:'preserve'}} modelCatalog={null} modelCatalogLoading={false}
  sessionSuggestions={[source]} workspacePathSuggestions={[{path:'README.md',isDirectory:false}]} agentCommands={[]} agentCommandsLoading={false} bind:text
  onSelectSessionReference={id=>{selected=id;text='';}} onSelectWorkspacePath={path=>{selected=path;}}
  onComposerInput={value=>{text=value;}} onAddAttachments={()=>{}} onAddDirectory={()=>{}} onRemoveAttachment={()=>{}} onSend={()=>{}} onQueue={()=>{}} onAbort={()=>{}} onSelectAccess={()=>{}} onLoadModels={()=>{}} onSelectModelConfiguration={()=>{}} />
<output>{selected}</output>
</div>
