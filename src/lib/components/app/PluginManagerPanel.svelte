<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '$lib/ui-kit';
  import type { PluginAuthenticationState } from '$lib/app/plugin-authentication-controller';
  import type { PluginLifecycleState } from '$lib/app/plugin-lifecycle-controller';

  import type {PluginInstallState} from '$lib/app/plugin-install-controller';

  type Installation = {
    id: string;
    pluginId: string;
    pluginVersion: string;
    enabled: boolean;
    installed: boolean;
    runnable: boolean;
    dependencies: { kind: string; name: string; required: boolean; available: boolean; versionRange: string | null; detectedVersion?: string | null; issue?: string | null }[];
    packageDependencies?: { dependencies: { pluginId: string; required: boolean; available: boolean; version: string | null; issue: string | null }[]; unavailableContributions: string[] };
    activationIssues?: string[];
    sessionProviders: { id: string; displayName: string }[];
    contributions?: { id: string; metadata: Record<string, unknown> }[];
    manifest: { displayName: string; authentication?: { kind: 'cli-terminal'; executable: string } };
  };

  type Props = {
    authentication?: PluginAuthenticationState;
    onAuthenticate?: (id: string, action: 'login' | 'status') => void;
    installation?: PluginInstallState;
    onInstallConfirm?: (reinstall:boolean)=>void;
    onSkipArchivedChange?: (value:boolean)=>void;
    onInstallCancel?: ()=>void;
    onUndo?: (id:string)=>void;
    installations: Installation[];
    busy: boolean;
    onInstall: () => void;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onUninstall: (id: string) => void;
    onConfigure: (installationId: string, contributionId: string) => void;
    onCreateSession: (installationId: string, agentId: string) => void;
    lifecycle?: PluginLifecycleState;
    onRemovalCancel?: () => void;
    onRemovalConfirm?: (keepHistory: boolean) => void;
    onMigrate?: (target: string) => void;
  };

  let { authentication, onAuthenticate, installation, onInstallConfirm, onSkipArchivedChange, onInstallCancel, onUndo, installations, busy, onInstall, onEnabledChange, onUninstall, onCreateSession, onConfigure, lifecycle, onRemovalCancel, onRemovalConfirm, onMigrate }: Props = $props();
  let selectedId = $state<string | null>(null);
  const installedPlugins = $derived(installations.filter(item => item.installed));
  const selected = $derived(installedPlugins.find(item => item.id === selectedId) ?? installedPlugins[0]);
  const undoTargets = $derived(installation?.undoTargets ?? []);
  let showingDetail = $state(false);

</script>

<Card aria-label={$t('plugins.title')} aria-busy={busy}>
  <CardHeader><CardTitle>{$t('plugins.title')}</CardTitle></CardHeader>
  <CardContent>
    <div class="plugin-manager">
      <p>{$t('plugins.description')}</p>
      {#if installation?.error}<p role="alert">{translateMessage($locale, installation.error)}</p>{/if}
      {#if installation?.notice}<p role="status">{translateMessage($locale, installation.notice)}</p>{/if}
      {#if installation?.preview}
        {@const preview=installation.preview}
        <section aria-label={$t('plugins.installImpact')} class="plugin-details">
          <h3>{preview.kind === 'downgrade' ? $t('plugins.downgrade') : preview.kind === 'replace' ? $t('plugins.replace') : preview.kind === 'upgrade' ? $t('plugins.upgrade') : $t('plugins.install')} · {preview.pluginId}</h3>
          <p>{preview.previous.length ? `${preview.previous.join('、')} → ` : ''}{preview.version}</p>
          {#each preview.impacts as impact}
            <p>{$t('plugins.references', { sessions: impact.sessions.length, bindings: impact.bindings.length, dependencies: impact.dependencies.length })}</p>
            {#each impact.sessions as session}<p>{$t('plugins.sessionPrefix')}{session.label}{preview.archivedSessions?.includes(session.id) ? $t('history.archivedSuffix') : ''}{preview.rebuildSessions?.includes(session.id) ? $t('plugins.rebuildSuffix') : ''}</p>{/each}
            {#each impact.bindings as binding}<p>{$t('plugins.bindingPrefix')}{binding.label}</p>{/each}
            {#each impact.dependencies as dependency}<p>{$t('plugins.dependencyPrefix')}{dependency.label}</p>{/each}
          {/each}
          {#each preview.blockers as blocker}<p role="alert">{blocker}</p>{/each}
          {#if preview.kind === 'downgrade'}
            <p role="alert">{$t('plugins.downgradeWarning')}</p>
          {:else if preview.previous.length}
            {#if preview.archivedSessions?.length}
              <label>
                <input type="checkbox" checked={installation.skipArchived} disabled={busy}
                  aria-describedby="skip-archived-description"
                  onchange={event => {
                    const checked = event.currentTarget.checked;
                    event.currentTarget.checked = installation.skipArchived;
                    onSkipArchivedChange?.(checked);
                  }} />
                {$t('plugins.skipArchived', { count: preview.archivedSessions.length })}
              </label>
              <p id="skip-archived-description">{$t('plugins.skipArchivedDescription')}</p>
            {/if}
            {#if preview.rebuildSessions?.length}
              <p>{$t('plugins.rebuildDescription')}</p>
            {/if}
            <p>{$t('plugins.upgradeDescription')}</p>
          {/if}
          <div class="plugin-actions">
            <Button disabled={busy || !!preview.blockers.length} onclick={()=>onInstallConfirm?.(preview.kind === 'downgrade')}>{preview.kind === 'downgrade' ? $t('plugins.clearAndDowngrade') : $t('plugins.confirmInstall')}</Button>
            <Button variant="outline" disabled={busy} onclick={onInstallCancel}>{$t('common.cancel')}</Button>
          </div>
        </section>
      {/if}
      {#if lifecycle}
        {#if lifecycle.error}<p role="alert">{translateMessage($locale, lifecycle.error)}</p>{/if}
        {#if lifecycle.report}
          <p role="status">{$t('plugins.migrationReport', { migrated: lifecycle.report.migrated.length, failed: lifecycle.report.failed.length })}</p>
          {#each lifecycle.report.failed as item}<p>{item.label}</p>{/each}
        {/if}
        {#if lifecycle.impact}
          {@const impact = lifecycle.impact}
          <section aria-label={$t('plugins.uninstallImpact')} class="plugin-details">
            <h3>{$t('plugins.uninstallHeading', { name: installations.find(item => item.id === impact.id)?.manifest.displayName ?? impact.id, version: installations.find(item => item.id === impact.id)?.pluginVersion ?? '' })}</h3>
            <p>{$t('plugins.uninstallDescription')}</p>
            <p>{$t('plugins.uninstallReferences', { sessions: impact.sessions.length, bindings: impact.bindings.length, dependencies: impact.dependencies.length, active: impact.active })}</p>
            {#each impact.sessions as item}<p>{$t('plugins.sessionPrefix')}{item.label}（{item.id}）</p>{/each}
            {#each impact.bindings as item}<p>{$t('plugins.bindingPrefix')}{item.label}</p>{/each}
            {#each impact.dependencies as item}<p>{$t('plugins.dependencyPrefix')}{item.label}</p>{/each}
            {#if impact.dependencies.length}<p role="alert">{$t('plugins.dependencyBlocker')}</p>{/if}
            {#if impact.sessions.length && !impact.targets.length}<p>{$t('plugins.migrationTargetNeeded')}</p>{/if}
            {#if impact.active}<p>{$t('plugins.stopBeforeUninstall')}</p>{/if}
            <div class="plugin-actions">
              {#each impact.targets as target}
                <Button disabled={busy || !impact.sessions.length} onclick={() => onMigrate?.(target.id)}>{$t('plugins.migrateTo', { name: target.label })}</Button>
              {/each}
              {#if impact.sessions.length || impact.bindings.length}
                <Button disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(true)}>{$t('plugins.keepHistoryAndRemove')}</Button>
              {:else}
                <Button disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(false)}>{$t('plugins.removeData')}</Button>
              {/if}
              <Button variant="outline" disabled={busy} onclick={onRemovalCancel}>{$t('common.cancel')}</Button>
            </div>
            {#if impact.sessions.length}<p>{$t('plugins.historyOnlyWarning')}</p>{/if}
          </section>
        {/if}
      {/if}
      <div class="plugin-actions">
        <Button type="button" variant="outline" disabled={busy} onclick={onInstall}>{$t('plugins.installDirectory')}</Button>
      </div>

      {#if installedPlugins.length === 0}
        <p role="status">{$t('plugins.empty')}</p>
      {:else}
        <div class="plugin-browser" class:showing-detail={showingDetail}>
          <nav class="plugin-navigation" aria-label={$t('plugins.installedList')}>
            {#each installedPlugins as installation (installation.id)}
              <Button variant={selected?.id === installation.id ? 'secondary' : 'ghost'} aria-pressed={selected?.id === installation.id}
                onclick={() => { selectedId = installation.id; showingDetail = true; }}>
                {installation.manifest.displayName} · {installation.pluginVersion}
              </Button>
            {/each}
          </nav>
          <div class="plugin-detail">
            <div class="plugin-list-back"><Button variant="ghost" onclick={() => (showingDetail = false)}>{$t('plugins.back')}</Button></div>
          {#each installedPlugins as installation (installation.id)}
            {#if selected?.id === installation.id}
            <Card aria-label={installation.manifest.displayName}>
              <CardHeader>
                <div class="plugin-heading">
                  <CardTitle>{installation.manifest.displayName}</CardTitle>
                  <Badge>{!installation.installed ? $t('plugins.uninstalled') : installation.enabled ? $t('plugins.enabled') : $t('plugins.disabled')}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div class="plugin-details">
                  <p>{installation.pluginId} · {installation.pluginVersion}</p>
                  {#each installation.dependencies as dependency (`${dependency.kind}:${dependency.name}`)}
                    <p role={dependency.required && !dependency.available ? 'alert' : undefined}>
                      {dependency.kind} · {dependency.name}{dependency.versionRange ? ` ${dependency.versionRange}` : ''}{dependency.detectedVersion ? $t('plugins.detectedVersion', { version: dependency.detectedVersion }) : ''} · {dependency.available ? $t('plugins.available') : dependency.required ? $t('plugins.requiredUnavailable', { issue: dependency.issue ? $t('plugins.issueSuffix', { issue: dependency.issue }) : '' }) : $t('plugins.optionalUnavailable', { issue: dependency.issue ? $t('plugins.issueSuffix', { issue: dependency.issue }) : '' })}
                    </p>
                  {/each}
                  {#each installation.packageDependencies?.dependencies ?? [] as dependency (dependency.pluginId)}
                    <p role={dependency.required && !dependency.available ? 'alert' : 'status'}>
                      {$t('plugins.packageDependency', { id: dependency.pluginId, version: dependency.version ? ` · ${dependency.version}` : '', status: dependency.available ? $t('plugins.available') : dependency.required ? $t('plugins.requiredMissing') : $t('plugins.optionalMissing'), issue: dependency.issue ? ` (${dependency.issue})` : '' })}
                    </p>
                  {/each}
                  {#each installation.activationIssues ?? [] as issue}<p role="status">{issue}</p>{/each}
                  {#if installation.manifest.authentication}
                    {@const auth = authentication?.entries[installation.id]}
                    <section aria-label={$t('plugins.authTitle')}>
                      <p>{$t('plugins.authDescription')}</p>
                      <div class="plugin-actions">
                        <Button variant="outline" disabled={busy || !installation.enabled || !installation.runnable} onclick={() => onAuthenticate?.(installation.id, 'login')}>{$t('plugins.login')}</Button>
                        <Button variant="outline" disabled={busy || !installation.enabled || !installation.runnable} onclick={() => onAuthenticate?.(installation.id, 'status')}>{$t('plugins.checkLogin')}</Button>
                      </div>
                      {#if !installation.enabled}<p>{$t('plugins.enableToLogin')}</p>{/if}
                      {#if authentication?.busyId === installation.id}<p role="status">{$t('plugins.authPending')}</p>{/if}
                      {#if auth?.error}<p role="alert">{translateMessage($locale, auth.error)}</p>
                      {:else if auth?.result === 'loginOpened'}<p role="status">{$t('plugins.loginOpened')}</p>
                      {:else if auth?.result === 'authenticated'}<p role="status">{$t('plugins.authenticated')}</p>
                      {:else if auth?.result === 'unauthenticated'}<p role="status">{$t('plugins.unauthenticated')}</p>{/if}
                    </section>
                  {/if}
                  <div class="plugin-actions">
                    {#if installation.installed}
                      <Button type="button" variant="outline" disabled={busy || (!installation.enabled && !installation.runnable)} onclick={() => onEnabledChange(installation.id, !installation.enabled)}>{installation.enabled ? $t('plugins.disable') : $t('plugins.enable')}</Button>
                      <Button type="button" variant="outline" disabled={busy} onclick={() => onUninstall(installation.id)}>{$t('plugins.uninstall')}</Button>
                      {#if undoTargets.includes(installation.id)}<Button variant="outline" disabled={busy} onclick={()=>onUndo?.(installation.id)}>{$t('plugins.undoUpgrade')}</Button>{/if}
                    {/if}
                    {#each installation.contributions?.filter(entry => entry.metadata.settings) ?? [] as entry (entry.id)}
                      <Button type="button" variant="outline" disabled={busy || !installation.installed} onclick={() => onConfigure(installation.id, entry.id)}>{$t('plugins.settingsFor', { name: String(entry.metadata.displayName ?? entry.id) })}</Button>
                    {/each}
                    {#each installation.sessionProviders as provider (provider.id)}
                      <Button type="button" disabled={busy || !installation.installed || !installation.enabled || !installation.runnable} onclick={() => onCreateSession(installation.id, provider.id)}>{$t('plugins.createSession', { name: provider.displayName })}</Button>
                    {/each}
                  </div>
                </div>
              </CardContent>
            </Card>
            {/if}
          {/each}
          </div>
        </div>
      {/if}
    </div>
  </CardContent>
</Card>

<style>
  .plugin-manager, .plugin-details { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .plugin-heading, .plugin-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .plugin-browser { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); gap: 16px; }
  .plugin-navigation { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .plugin-detail { min-width: 0; }
  .plugin-list-back { display: none; }
  @media (max-width: 720px) {
    .plugin-browser { grid-template-columns: minmax(0, 1fr); }
    .plugin-browser:not(.showing-detail) .plugin-detail, .plugin-browser.showing-detail .plugin-navigation { display: none; }
    .plugin-list-back { display: block; margin-bottom: 8px; }
  }
</style>
