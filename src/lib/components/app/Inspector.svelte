<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import { AgentStatusMark, FileChangeMark, Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon } from '$lib/ui-kit';
  import type { AgentIcon } from '../../../../packages/plugin-protocol/src/agent-icon';
  import type { PresentationArtifactPreview } from '../../../../packages/plugin-protocol/src/presentation-inspector';
  import ProjectActionsPanel from './ProjectActionsPanel.svelte';
  import SidePanelTabs from './SidePanelTabs.svelte';
  import { relativeTimeLabel, formatBytes } from './session-utils';
  import type {
    AgentDiagnostic,
    CodexThreadListItem,
    SessionPanelView,
    WorkspaceListItem,
  } from './view-types';
  import type { Artifact, ArtifactContent, CheckpointFile, ContextAttachment, GitFileAction, ProjectAction, ProjectActionKind, ProjectActionRun, RestoreOperation, SessionExecutionProfile, TurnChangeSet, TurnFileDiff, WorkspaceCapabilityInventory, WorkspaceChanges } from '$lib/types';

  type InspectorProps = {
    visible: boolean;
    workspace: WorkspaceListItem | null;
    session: SessionPanelView | null;
    /** Provider identity declared by the session's plugin; absent when unknown. */
    sessionProvider?: { label: string; icon?: AgentIcon };
    desktop: boolean;
    diagnostics: AgentDiagnostic[];
    workspaceCapabilities: WorkspaceCapabilityInventory | null;
    codexThreads: CodexThreadListItem[];
    executionProfile: SessionExecutionProfile | null;
    attachments: ContextAttachment[];
    artifacts: Artifact[];
    projectActions: ProjectAction[];
    projectActionRuns: ProjectActionRun[];
    turnChangeSet: TurnChangeSet | null;
    checkpoints: CheckpointFile[];
    restoreOperations: RestoreOperation[];
    workspaceChanges: WorkspaceChanges | null;
    activeView: 'context' | 'git';
    turnFileDiff: TurnFileDiff | null;
    threadBusy: boolean;
    busy: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    onSyncCodexThreads: () => void;
    onRestoreTurnChangeSet: (sessionId: string, turnId: string) => void;
    onShowTurnFileDiff: (sessionId: string, turnId: string, path: string) => void;
    onApplyGitFileAction: (sessionId: string, turnId: string, path: string, action: GitFileAction) => void;
    onApplyGitHunkAction: (sessionId: string, turnId: string, path: string, hunkIndex: number, action: GitFileAction) => void;
    artifactPreview: PresentationArtifactPreview;
    onToggleArtifact: (sessionId: string, artifactId: string) => Promise<void>;
    projectEditor: import('../../../../packages/plugin-protocol/src/presentation-inspector').PresentationProjectEditor;
    runningActionId: string | null;
    onEditProjectAction: (id: string | null) => void;
    onProjectField: (field: import('$lib/app/project-editor-controller').ProjectEditorField, value: string) => void;
    onSaveProjectEditor: () => Promise<void>;
    onCloseProjectEditor: () => void;
    onDeleteProjectAction: (actionId: string) => Promise<void>;
    onRunProjectAction: (actionId: string) => Promise<void>;
    onCancelProjectAction: (runId: string) => Promise<void>;
    onRefresh: () => void;
    onSelectView: (view: 'context' | 'git') => void;
  };

  let {
    visible,
    workspace,
    session,
    sessionProvider,
    desktop,
    diagnostics,
    workspaceCapabilities,
    codexThreads,
    executionProfile,
    attachments,
    artifacts,
    projectActions,
    projectActionRuns,
    turnChangeSet,
    checkpoints,
    restoreOperations,
    workspaceChanges,
    activeView,
    turnFileDiff,
    threadBusy,
    busy,
    sessionRunning,
    selectedSessionArchiving,
    onSyncCodexThreads,
    onRestoreTurnChangeSet,
    onShowTurnFileDiff,
    onApplyGitFileAction,
    onApplyGitHunkAction,
    artifactPreview,
    onToggleArtifact,
    projectEditor, runningActionId, onEditProjectAction, onProjectField, onSaveProjectEditor, onCloseProjectEditor,
    onDeleteProjectAction,
    onRunProjectAction,
    onCancelProjectAction,
    onRefresh,
    onSelectView,
  }: InspectorProps = $props();

  const expandedArtifactId = $derived(artifactPreview.artifactId);
  const artifactContent = $derived(artifactPreview.content);
  const artifactLoading = $derived(artifactPreview.loading);
  const turnFileIsRename = $derived(
    Boolean(turnChangeSet && turnFileDiff && turnChangeSet.files.find((file) => file.path === turnFileDiff.path)?.kind === 'renamed'),
  );
  async function toggleArtifact(artifact: Artifact): Promise<void> {
    if (session) await onToggleArtifact(session.id, artifact.id);
  }

  function modeLabel(mode: string): string {
    return mode === 'plan' ? $t('inspector.plan') : mode === 'edit' ? $t('common.edit') : $t('inspector.ask');
  }

  function filesystemLabel(policy: string): string {
    if (policy === 'agent-managed') return $t('inspector.nativePermissions');
    return policy === 'workspace-write' ? $t('inspector.workspaceWrite') : $t('inspector.readOnly');
  }

  function commandLabel(policy: string): string {
    if (policy === 'agent-managed') return $t('inspector.nativePermissions');
    return policy === 'trusted' ? $t('inspector.automatic') : policy === 'approved' ? $t('inspector.approvalRequired') : $t('inspector.disabled');
  }

  function networkLabel(policy: string): string {
    return policy === 'agent-managed' ? $t('inspector.agentManaged') : $t('inspector.disabled');
  }

  function profileValue(label: (value: string) => string, requested: string, enforced: string): string {
    const requestedLabel = label(requested);
    const enforcedLabel = label(enforced);
    return requestedLabel === enforcedLabel ? enforcedLabel : `${requestedLabel} → ${enforcedLabel}`;
  }

  function optionalProfileValue(requested: string | null | undefined, enforced: string | null | undefined): string {
    const requestedLabel = requested ?? $t('composer.default');
    const enforcedLabel = enforced ?? $t('composer.default');
    return requestedLabel === enforcedLabel ? enforcedLabel : `${requestedLabel} → ${enforcedLabel}`;
  }
</script>

{#snippet refreshControl()}
  <Button variant="ghost" size="icon" aria-label={$t('inspector.refresh')} title={$t('inspector.refresh')} disabled={busy || threadBusy} onclick={() => { onRefresh(); if (workspace && desktop) onSyncCodexThreads(); }}><Icon name="refresh" size={14} /></Button>
{/snippet}

<Card as="aside" class="inspector" hidden={!visible} data-ui-component="inspector" aria-label={$t('inspector.context')}>
  <SidePanelTabs {activeView} gitCount={workspaceChanges?.files.length} onSelect={onSelectView} />
  <div id="side-panel-content-context" class="side-panel-view" role="tabpanel" aria-labelledby="side-panel-tab-context">
  <ProjectActionsPanel
    workspace={workspace}
    {desktop}
    {projectActions}
    {projectActionRuns}
    {busy}
    editor={projectEditor}
    {runningActionId}
    {onEditProjectAction}
    {onProjectField}
    {onSaveProjectEditor}
    {onCloseProjectEditor}
    {onDeleteProjectAction}
    {onRunProjectAction}
    {onCancelProjectAction}
  />

  {#if workspace && desktop}
    {#if !session}
    <Card class="capability-checker-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>{$t('inspector.agentInspection')}</CardTitle>
        <Badge variant="outline">{diagnostics.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if diagnostics.length === 0}
          <p class="thread-empty">{$t('inspector.noInspection')}</p>
        {:else}
          <div class="thread-list" aria-label={$t('inspector.localInspection')}>
            {#each diagnostics as agent (agent.agent)}
              <div class="thread-item capability-checker-item">
                <div class="thread-copy">
                  <strong>{agent.label}</strong>
                  <small>{agent.version ?? agent.message ?? $t('inspector.noVersion')}</small>
                </div>
                <Badge variant={agent.status === 'ready' ? 'success' : agent.status === 'missing' ? 'warning' : 'destructive'}>
                  {agent.status === 'ready' ? $t('inspector.available') : agent.status === 'missing' ? $t('inspector.notInstalled') : $t('inspector.error')}
                </Badge>
              </div>
              {#if agent.capabilities.length > 0}
                <div class="capability-list capability-checker-list">
                  {#each agent.capabilities as capability}<Badge variant="outline">{capability}</Badge>{/each}
                </div>
              {/if}
              {#if agent.message}<p class="thread-empty capability-checker-message">{agent.message}</p>{/if}
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
    {/if}
    {#if workspaceCapabilities}
      <Card class="workspace-capabilities-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>{$t('inspector.workspaceCapabilities')}</CardTitle>
          <Badge variant="outline">
            {workspaceCapabilities.instructions.length + workspaceCapabilities.skills.length + workspaceCapabilities.tools.length + workspaceCapabilities.mcpServers.length}
          </Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <div class="workspace-capability-groups">
            <section class="workspace-capability-group" aria-labelledby="workspace-instructions-title">
              <strong id="workspace-instructions-title">{$t('inspector.instructions')}</strong>
              {#if workspaceCapabilities.instructions.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.instructions as entry (entry.source)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">{$t('inspector.notFound')}</small>{/if}
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-skills-title">
              <strong id="workspace-skills-title">{$t('composer.category.skill')}</strong>
              {#if workspaceCapabilities.skills.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.skills as entry (entry.source)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">{$t('inspector.notFound')}</small>{/if}
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-tools-title">
              <strong id="workspace-tools-title">{$t('inspector.coreTools')}</strong>
              <div class="capability-list">
                {#each workspaceCapabilities.tools as entry (entry.name)}
                  <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                {/each}
              </div>
            </section>
            <section class="workspace-capability-group" aria-labelledby="workspace-mcp-title">
              <strong id="workspace-mcp-title">MCP</strong>
              {#if workspaceCapabilities.mcpServers.length > 0}
                <div class="capability-list">
                  {#each workspaceCapabilities.mcpServers as entry (entry.source + entry.name)}
                    <Badge variant="outline" title={entry.source}>{entry.name}</Badge>
                  {/each}
                </div>
              {:else}<small class="thread-empty">{$t('inspector.notFound')}</small>{/if}
            </section>
          </div>
          {#if workspaceCapabilities.warnings.length > 0}
            <p class="profile-warning">{$t('inspector.warnings', { warnings: workspaceCapabilities.warnings.join('; ') })}</p>
          {/if}
        </CardContent>
      </Card>
    {/if}
  {/if}

  {#if session}
    <Card class="session-context-card">
      <CardHeader class="session-context-heading">
        <div class="session-context-title">
          <AgentStatusMark agent="plugin" icon={sessionProvider?.icon} tone="idle" label={sessionProvider?.label ?? session.agent} />
          <div>
            <CardTitle>{session.label}</CardTitle>
            <small>{sessionProvider?.label ?? session.agent}</small>
          </div>
        </div>
        {@render refreshControl()}
      </CardHeader>
      <CardContent class="session-context-content">
        <dl>
          <div><dt>{$t('inspector.sessionId')}</dt><dd title={session.id}>{session.id}</dd></div>
          {#if session.externalSessionId}<div><dt>{$t('inspector.remoteBinding')}</dt><dd title={session.externalSessionId}>{session.externalSessionId}</dd></div>{/if}
          <div><dt>{$t('inspector.updatedAt')}</dt><dd><time datetime={session.updatedAt} title={session.updatedAt}>{relativeTimeLabel(session.updatedAt, $locale)}</time></dd></div>
        </dl>
      </CardContent>
    </Card>
    <Card class="artifacts-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>{$t('inspector.artifacts')}</CardTitle>
        <Badge variant={artifacts.length > 0 ? 'outline' : 'secondary'}>{artifacts.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if artifacts.length === 0}
          <p class="thread-empty">{$t('inspector.noArtifacts')}</p>
        {:else}
          <div class="thread-list" aria-label={$t('inspector.artifacts')}>
            {#each artifacts as artifact (artifact.id)}
              <div class="thread-item changeset-file artifact-item">
                <Icon name="folder-add" size={13} />
                <div class="thread-copy">
                  <strong>{artifact.source}</strong>
                  <small>{artifact.mediaType} · {artifact.size} bytes · {artifact.turnId ? $t('inspector.artifactTurn', { turn: artifact.turnId.slice(0, 8) }) : $t('inspector.sessionLevel')} · {artifact.contentHash.slice(0, 16)}…</small>
                </div>
                <Button variant="ghost" size="sm" type="button" onclick={() => void toggleArtifact(artifact)} disabled={artifactLoading && expandedArtifactId === artifact.id}>
                  {expandedArtifactId === artifact.id ? artifactPreview.error ? $t('common.retry') : $t('inspector.collapse') : $t('inspector.view')}
                </Button>
              </div>
              {#if expandedArtifactId === artifact.id}
                <div class="artifact-preview">
                  {#if artifactLoading}<span class="thread-empty">{$t('inspector.reading')}</span>
                  {:else if artifactPreview.error}<p role="alert">{artifactPreview.error}</p>
                  {:else if artifactContent}<pre>{artifactContent.content}{artifactContent.truncated ? $t('inspector.contentTruncated') : ''}</pre>
                  {:else}<span class="thread-empty">{$t('inspector.artifactUnavailable')}</span>{/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>
    {#if executionProfile}
      <Card class="profile-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>{executionProfile.nativeSandbox ? $t('inspector.nativePermissionTitle') : $t('inspector.executionProfile')}</CardTitle>
          <Badge variant={executionProfile.nativeSandbox ? 'success' : 'warning'}>
            {executionProfile.nativeSandbox ? $t('inspector.nativeSandbox') : $t('inspector.noNativeSandbox')}
          </Badge>
        </CardHeader>
        <CardContent class="profile-card-content">
          {#if executionProfile.nativeSandbox}
            <dl>
              <div><dt>{$t('inspector.approval')}</dt><dd>{executionProfile.enforced.approvalPolicy}</dd></div>
              <div><dt>{$t('inspector.reviewer')}</dt><dd>{executionProfile.enforced.approvalReviewer}</dd></div>
              <div><dt>{$t('inspector.sandbox')}</dt><dd>{executionProfile.agentManagedPermissions ? $t('inspector.agentPermissionDescription') : executionProfile.enforced.filesystemPolicy}</dd></div>
              {#if executionProfile.enforced.model}<div><dt>{$t('composer.model')}</dt><dd>{executionProfile.enforced.model}</dd></div>{/if}
              {#if executionProfile.enforced.reasoningEffort}<div><dt>{$t('inspector.reasoning')}</dt><dd>{executionProfile.enforced.reasoningEffort}</dd></div>{/if}
            </dl>
            <p class="thread-empty">{$t('inspector.permissionsDescription')}</p>
          {:else}
            <dl>
              <div><dt>{$t('inspector.mode')}</dt><dd>{profileValue(modeLabel, executionProfile.requested.interactionMode, executionProfile.enforced.interactionMode)}</dd></div>
              <div><dt>{$t('inspector.file')}</dt><dd>{profileValue(filesystemLabel, executionProfile.requested.filesystemPolicy, executionProfile.enforced.filesystemPolicy)}</dd></div>
              <div><dt>{$t('inspector.command')}</dt><dd>{profileValue(commandLabel, executionProfile.requested.commandPolicy, executionProfile.enforced.commandPolicy)}</dd></div>
              <div><dt>{$t('inspector.approval')}</dt><dd>{profileValue((value) => value, executionProfile.requested.approvalPolicy, executionProfile.enforced.approvalPolicy)}</dd></div>
              <div><dt>{$t('inspector.network')}</dt><dd>{profileValue(networkLabel, executionProfile.requested.networkPolicy, executionProfile.enforced.networkPolicy)}</dd></div>
              {#if executionProfile.requested.model || executionProfile.enforced.model}<div><dt>{$t('composer.model')}</dt><dd>{optionalProfileValue(executionProfile.requested.model, executionProfile.enforced.model)}</dd></div>{/if}
              {#if executionProfile.requested.reasoningEffort || executionProfile.enforced.reasoningEffort}<div><dt>{$t('inspector.reasoning')}</dt><dd>{optionalProfileValue(executionProfile.requested.reasoningEffort, executionProfile.enforced.reasoningEffort)}</dd></div>{/if}
            </dl>
            {#if executionProfile.unsupported.length > 0}
              <p class="profile-warning">{$t('composer.unsupported', { features: executionProfile.unsupported.join(', ') })}</p>
            {/if}
          {/if}
        </CardContent>
      </Card>
      <Card class="capabilities-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>{$t('inspector.agentCapabilities')}</CardTitle>
          <Badge variant="outline">{executionProfile.adapterCapabilities.length}</Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          {#if executionProfile.adapterCapabilities.length > 0}
            <div class="capability-list" aria-label={$t('inspector.currentCapabilities')}>
              {#each executionProfile.adapterCapabilities as capability}
                <Badge variant="outline">{capability}</Badge>
              {/each}
            </div>
          {:else}
            <p class="thread-empty">{$t('inspector.noCapabilities')}</p>
          {/if}
          {#if executionProfile.unsupported.length > 0}
            <p class="profile-warning">{$t('inspector.unsupported', { features: executionProfile.unsupported.join(', ') })}</p>
          {/if}
        </CardContent>
      </Card>
    {/if}
    <Card class="attachments-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>{$t('inspector.attachments')}</CardTitle>
        <Badge variant={attachments.length > 0 ? 'outline' : 'secondary'}>{attachments.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if attachments.length === 0}
          <p class="thread-empty">{$t('inspector.noAttachments')}</p>
        {:else}
          <ul class="context-attachment-list" aria-label={$t('inspector.currentAttachments')}>
            {#each attachments as attachment (attachment.id)}
              <li class="context-attachment" title={attachment.displayName ?? attachment.path}>
                <Icon name={attachment.mediaType === 'inode/directory' ? 'folder' : 'file'} size={16} />
                <span class="context-attachment-name">{attachment.displayName ?? (attachment.path.split(/[\\/]/).pop() || attachment.path)}</span>
                <span class="context-attachment-meta">{attachment.turnId ? $t('inspector.sent') : $t('inspector.pending')} · {attachment.sendStrategy === 'reference' ? $t('inspector.reference') : $t('inspector.inline')}{attachment.size === null ? '' : ` · ${formatBytes(attachment.size)}`}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>
    {#if turnChangeSet}
      <Card class="changeset-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>{$t('inspector.turnChanges')}</CardTitle>
          <Badge variant={turnChangeSet.files.length > 0 ? 'warning' : 'secondary'}>
            {$t('inspector.fileCount', { count: turnChangeSet.files.length })}
          </Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <small class="changeset-status">{turnChangeSet.captureStatus === 'captured' ? $t('inspector.captured') : turnChangeSet.captureStatus === 'partial' ? $t('inspector.partialCapture') : $t('inspector.captureFailed')} · {turnChangeSet.attribution}</small>
          {#if checkpoints.length > 0}
            <div class="checkpoint-summary" aria-label={$t('inspector.checkpoints')}>
              <div class="checkpoint-summary-heading">
                <span>{$t('inspector.checkpointCount', { available: checkpoints.filter((item) => item.available).length, total: checkpoints.length })}</span>
                <small>{$t('inspector.baselineFiles')}</small>
              </div>
              <div class="checkpoint-list">
                {#each checkpoints.slice(0, 6) as checkpoint (checkpoint.id)}
                  <div class="checkpoint-item">
                    <code title={checkpoint.path}>{checkpoint.path}</code>
                    <span class="checkpoint-item-badges" title={checkpoint.reason ?? undefined}>
                      {#if checkpoint.baselineDirty}<Badge variant="warning">{$t('inspector.mixed')}</Badge>{/if}
                      <Badge variant={checkpoint.available ? 'success' : 'warning'}>{checkpoint.available ? $t('inspector.recoverable') : $t('inspector.unavailable')}</Badge>
                    </span>
                  </div>
                {/each}
              </div>
              {#if checkpoints.length > 6}<small class="thread-more">{$t('inspector.moreBaseline', { count: checkpoints.length - 6 })}</small>{/if}
            </div>
          {/if}
          {#if turnChangeSet.commands.length > 0}
            <small class="changeset-status">{$t('inspector.commandCount', { count: turnChangeSet.commands.length })}</small>
            <div class="thread-list" aria-label={$t('inspector.turnCommands')}>
              {#each turnChangeSet.commands.slice(0, 5) as command (command.id)}
                <div class="thread-item changeset-file">
                  <span class={`change-kind ${command.status === 'failed' ? 'change-kind-deleted' : 'change-kind-modified'}`}>{command.status === 'failed' ? '!' : '>'}</span>
                  <div class="thread-copy">
                    <code title={command.command ?? command.output}>{command.command || command.output || command.toolName || $t('inspector.command')}</code>
                    <small>{command.cwd ?? $t('inspector.currentWorkspace')}{command.exitCode === null ? '' : $t('project.exitCode', { code: command.exitCode })}</small>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if turnChangeSet.verification.length > 0}
            <small class="changeset-status">{$t('inspector.verification', { passed: turnChangeSet.verification.filter((item) => item.status === 'passed').length, total: turnChangeSet.verification.length })}</small>
          {/if}
          {#if turnChangeSet.files.length > 0}
            <div class="thread-list" aria-label={$t('inspector.turnFiles')}>
              {#each turnChangeSet.files.slice(0, 8) as file (file.path)}
                <div class="thread-item changeset-file changeset-file-row">
                  <Button variant="ghost" size="sm" type="button" class="changeset-file-button" onclick={() => onShowTurnFileDiff(turnChangeSet.sessionId, turnChangeSet.turnId, file.path)} disabled={busy || sessionRunning || selectedSessionArchiving} title={$t('inspector.viewDiff')}>
                    <FileChangeMark kind={file.kind} />
                    <code title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
                      {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                    </code>
                    {#if file.baselineDirty}<Badge variant="warning">{$t('inspector.preexistingChanges')}</Badge>{/if}
                  </Button>
                  {#if workspaceChanges?.captureStatus === 'captured'}
                    <div class="changeset-actions">
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'stage')} disabled={busy || sessionRunning || selectedSessionArchiving} title={$t('inspector.stage')}>{$t('inspector.stage')}</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'unstage')} disabled={busy || sessionRunning || selectedSessionArchiving} title={$t('inspector.unstageTitle')}>{$t('inspector.unstage')}</Button>
                      <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitFileAction(turnChangeSet.sessionId, turnChangeSet.turnId, file.path, 'revert')} disabled={busy || sessionRunning || selectedSessionArchiving || file.baselineDirty} title={file.baselineDirty ? $t('inspector.revertBlocked') : $t('inspector.revertTitle')}>{$t('inspector.revert')}</Button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {#if turnChangeSet.files.length > 8}<small class="thread-more">{$t('inspector.moreFiles', { count: turnChangeSet.files.length - 8 })}</small>{/if}
          {:else}
            <p class="thread-empty">{$t('inspector.noTurnChanges')}</p>
          {/if}
          {#if turnChangeSet.captureError}<p class="profile-warning">{turnChangeSet.captureError}</p>{/if}
          {#if turnFileDiff}
            <div class="turn-file-diff">
              <small>{turnFileDiff.path}</small>
              {#if turnFileDiff.available}
                {#if turnFileDiff.hunks.length > 0}
                  <div class="turn-diff-hunks" aria-label={$t('inspector.diffHunks')}>
                    {#each turnFileDiff.hunks as hunk (hunk.index)}
                      <details class="turn-diff-hunk" open={turnFileDiff.hunks.length === 1}>
                        <summary><code>Hunk {hunk.index + 1}</code><span>{hunk.header}</span></summary>
                        <pre>{hunk.content}</pre>
                        {#if !turnFileIsRename}
                          <div class="turn-diff-hunk-actions">
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'stage')} disabled={busy || sessionRunning || selectedSessionArchiving}>{$t('inspector.stage')}</Button>
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'unstage')} disabled={busy || sessionRunning || selectedSessionArchiving}>{$t('inspector.unstage')}</Button>
                            <Button variant="ghost" size="sm" type="button" onclick={() => onApplyGitHunkAction(turnChangeSet.sessionId, turnChangeSet.turnId, turnFileDiff.path, hunk.index, 'revert')} disabled={busy || sessionRunning || selectedSessionArchiving}>{$t('inspector.revert')}</Button>
                          </div>
                        {:else}
                          <small class="thread-empty">{$t('inspector.renameRestore')}</small>
                        {/if}
                      </details>
                    {/each}
                  </div>
                {:else}
                  <pre>{turnFileDiff.diff || $t('inspector.noDiff')}</pre>
                {/if}
              {:else}
                <p class="thread-empty">{turnFileDiff.reason}</p>
              {/if}
            </div>
          {/if}
          {#if turnChangeSet.files.length > 0}
            <Button variant="outline" size="sm" type="button" onclick={() => onRestoreTurnChangeSet(turnChangeSet.sessionId, turnChangeSet.turnId)} disabled={busy || sessionRunning || selectedSessionArchiving || turnChangeSet.attribution !== 'agent'}>
              <Icon name="undo" size={13} /> {$t('inspector.restoreTurn')}
            </Button>
          {/if}
        </CardContent>
      </Card>
    {/if}
    {#if restoreOperations.length > 0}
      <Card class="changeset-card restore-audit-card">
        <CardHeader class="thread-card-heading">
          <CardTitle>{$t('inspector.restoreHistory')}</CardTitle>
          <Badge variant="outline">{restoreOperations.length}</Badge>
        </CardHeader>
        <CardContent class="thread-card-content">
          <div class="thread-list" aria-label={$t('inspector.restoreAudit')}>
            {#each restoreOperations.slice(0, 5) as operation (operation.id)}
              <div class="thread-item changeset-file">
                <span class={`change-kind ${operation.status === 'completed' ? 'change-kind-added' : operation.status === 'blocked' ? 'change-kind-modified' : 'change-kind-deleted'}`}>
                  {operation.status === 'completed' ? '✓' : operation.status === 'blocked' ? '!' : '×'}
                </span>
                <div class="thread-copy">
                  <strong>{operation.status === 'completed' ? $t('inspector.restored') : operation.status === 'blocked' ? $t('inspector.restoreBlocked') : $t('inspector.restoreFailed')}</strong>
                  <small>{$t('inspector.restoreCounts', { restored: operation.restored.length, conflicts: operation.conflicts.length, unsupported: operation.unsupported.length })}</small>
                </div>
              </div>
            {/each}
          </div>
          {#if restoreOperations.length > 5}<small class="thread-more">{$t('inspector.moreRestores', { count: restoreOperations.length - 5 })}</small>{/if}
        </CardContent>
      </Card>
    {/if}
  {:else}
    <div class="inspector-empty">{$t('inspector.noSession')}</div>
  {/if}

  {#if workspace && desktop}
    <Card class="thread-card">
      <CardHeader class="thread-card-heading">
        <CardTitle>{$t('inspector.remoteSessions')}</CardTitle>
        <Badge variant="secondary" class="count-pill">{codexThreads.length}</Badge>
      </CardHeader>
      <CardContent class="thread-card-content">
        {#if codexThreads.length === 0}
          <p class="thread-empty">{$t('inspector.noRemoteThreads')}</p>
        {:else}
          <div class="thread-list" aria-label={$t('inspector.remoteList')}>
            {#each codexThreads.slice(0, 5) as thread (thread.id)}
              <div class="thread-item">
                <div class="thread-copy">
                  <strong>{thread.title ?? thread.id}</strong>
                  <small>{thread.cwd ?? $t('inspector.currentWorkspace')}{thread.updatedAt ? ` · ${thread.updatedAt}` : ''}</small>
                </div>
                <Badge variant="outline">{thread.status ?? 'unknown'}</Badge>
              </div>
            {/each}
          </div>
          {#if codexThreads.length > 5}<small class="thread-more">{$t('inspector.recentThreads')}</small>{/if}
        {/if}

      </CardContent>
    </Card>
  {/if}

  {#if workspace}
    <Card class="trust-card" data-trust={workspace.trust}>
      <div class="trust-card-heading"><Icon name="trust" size={16} /><strong>{$t('inspector.workspaceTrust')}</strong>{#if !session}{@render refreshControl()}{/if}</div>
      <p>{workspace.trust === 'trusted' ? $t('inspector.trustedDescription') : $t('inspector.untrustedDescription')}</p>
    </Card>
  {/if}

  </div>
</Card>
