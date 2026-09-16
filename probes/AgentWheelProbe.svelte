<script>
  import WorkspaceSidebar from '../src/lib/components/app/WorkspaceSidebar.svelte';
  import { readySessionProviders } from '../src/lib/app/session-providers';
  let installations = $state([]);
  let createSessionWorkspaceId = $state(null);
  const choices = $derived(readySessionProviders(installations));
  const noop = () => {};
  export const calls = [];
  export function setInstallations(value) { installations = value; }
</script>

<WorkspaceSidebar
  workspaces={[{id:'workspace',label:'Wheel test',path:'/test',trust:'trusted'}]}
  sessionsByWorkspace={{}} selectedWorkspaceId="workspace" expandedWorkspaceIds={['workspace']}
  selectedSessionId={null} sessionsLoadingWorkspaceIds={[]} busy={false} threadBusy={false}
  archivingWorkspaceId={null} archivingSessionId={null} sessionSearchOpen={false} sessionFilterOpen={false}
  {createSessionWorkspaceId} renamingSessionId={null} agentChoices={choices}
  onToggleSessionCreator={id => createSessionWorkspaceId = createSessionWorkspaceId === id ? null : id}
  onCreateAgent={(workspaceId, choiceId) => {
    const choice = choices.find(choice => choice.id === choiceId);
    calls.push([workspaceId, choice.installationId, choice.contributionId]);
  }}
  onToggleSearch={noop} onToggleFilter={noop} onApplyFilters={noop} onChooseWorkspaceDirectory={noop}
  onSelectWorkspace={noop} onToggleTrust={noop} onDeleteWorkspace={noop} onOpenWorkspaceLocation={noop}
  onSelectSession={noop} onUnarchiveSession={noop} onRequestArchiveSession={noop} onSyncCodexThread={noop}
  onBeginRenameSession={noop} onSaveSessionRename={noop} onCancelRenameSession={noop}
/>
