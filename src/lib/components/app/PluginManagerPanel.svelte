<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '$lib/ui-kit';
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
    selectedId?: string | null;
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

  let { selectedId = $bindable(null), authentication, onAuthenticate, installation, onInstallConfirm, onSkipArchivedChange, onInstallCancel, onUndo, installations, busy, onInstall, onEnabledChange, onUninstall, onCreateSession, onConfigure, lifecycle, onRemovalCancel, onRemovalConfirm, onMigrate }: Props = $props();
  const installedPlugins = $derived(installations.filter(item => item.installed));
  const selected = $derived(installedPlugins.find(item => item.id === selectedId) ?? installedPlugins[0]);
  const undoTargets = $derived(installation?.undoTargets ?? []);
  let showingDetail = $state(selectedId !== null);
  const uid = $props.id();

  // Status lives in a Badge; the secondary line only carries facts that explain it.
  const statusVariant = (available: boolean, required: boolean) => available ? 'success' : required ? 'destructive' : 'warning';
  const meta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

</script>

<section class="settings-section" aria-label={$t('plugins.title')} aria-busy={busy}>
  <div class="settings-section-heading">
    <div><h2>{$t('plugins.title')}</h2><p>{$t('plugins.description')}</p></div>
    <Button type="button" variant="outline" size="sm" disabled={busy} onclick={onInstall}>{$t('plugins.installDirectory')}</Button>
  </div>
  <div class="settings-section-body">
    <div class="plugin-manager">
      {#if installation?.error}<p role="alert">{translateMessage($locale, installation.error)}</p>{/if}
      {#if installation?.notice}<p role="status">{translateMessage($locale, installation.notice)}</p>{/if}
      {#if installation?.preview}
        {@const preview=installation.preview}
        <section aria-label={$t('plugins.installImpact')} class="settings-block">
          <h3>{preview.kind === 'downgrade' ? $t('plugins.downgrade') : preview.kind === 'replace' ? $t('plugins.replace') : preview.kind === 'upgrade' ? $t('plugins.upgrade') : $t('plugins.install')} · {preview.pluginId}</h3>
          <p class="settings-row-meta">{preview.previous.length ? `${preview.previous.join('、')} → ` : ''}{preview.version}</p>
          {#each preview.impacts as impact}
            {@render impactGroup($t('plugins.impactSessions'), impact.sessions.map(session => `${session.label}${preview.archivedSessions?.includes(session.id) ? $t('history.archivedSuffix') : ''}${preview.rebuildSessions?.includes(session.id) ? $t('plugins.rebuildSuffix') : ''}`))}
            {@render impactGroup($t('plugins.impactBindings'), impact.bindings.map(binding => binding.label))}
            {@render impactGroup($t('plugins.impactDependencies'), impact.dependencies.map(dependency => dependency.label))}
          {/each}
          {#if preview.kind !== 'downgrade' && preview.previous.length}
            {#if preview.archivedSessions?.length}
              <label class="settings-check">
                <input type="checkbox" checked={installation.skipArchived} disabled={busy}
                  aria-describedby="skip-archived-description"
                  onchange={event => {
                    const checked = event.currentTarget.checked;
                    event.currentTarget.checked = installation.skipArchived;
                    onSkipArchivedChange?.(checked);
                  }} />
                {$t('plugins.skipArchived', { count: preview.archivedSessions.length })}
              </label>
              <p id="skip-archived-description" class="settings-row-meta">{$t('plugins.skipArchivedDescription')}</p>
            {/if}
            {#if preview.rebuildSessions?.length}<p class="settings-row-meta">{$t('plugins.rebuildDescription')}</p>{/if}
            <p class="settings-row-meta">{$t('plugins.upgradeDescription')}</p>
          {/if}
          {#each preview.blockers as blocker}<p role="alert">{blocker}</p>{/each}
          {#if preview.kind === 'downgrade'}<p role="alert">{$t('plugins.downgradeWarning')}</p>{/if}
          <div class="settings-row-actions">
            <Button variant={preview.kind === 'downgrade' ? 'destructive' : 'default'} disabled={busy || !!preview.blockers.length} onclick={()=>onInstallConfirm?.(preview.kind === 'downgrade')}>{preview.kind === 'downgrade' ? $t('plugins.clearAndDowngrade') : $t('plugins.confirmInstall')}</Button>
            <Button variant="ghost" disabled={busy} onclick={onInstallCancel}>{$t('common.cancel')}</Button>
          </div>
        </section>
      {/if}
      {#if lifecycle}
        {#if lifecycle.error}<p role="alert">{translateMessage($locale, lifecycle.error)}</p>{/if}
        {#if lifecycle.report}
          <p role="status">{$t('plugins.migrationReport', { migrated: lifecycle.report.migrated.length, failed: lifecycle.report.failed.length })}</p>
          {@render impactGroup('', lifecycle.report.failed.map(item => item.label))}
        {/if}
        {#if lifecycle.impact}
          {@const impact = lifecycle.impact}
          {@const target = installations.find(item => item.id === impact.id)}
          <section aria-label={$t('plugins.uninstallImpact')} class="settings-block">
            <h3>{$t('plugins.uninstallHeading', { name: target?.manifest.displayName ?? impact.id, version: target?.pluginVersion ?? '' })}</h3>
            <p class="settings-row-meta">{$t('plugins.uninstallDescription')}</p>
            {@render impactGroup($t('plugins.impactSessions'), impact.sessions.map(item => `${item.label}（${item.id}）`))}
            {@render impactGroup($t('plugins.impactBindings'), impact.bindings.map(item => item.label))}
            {@render impactGroup($t('plugins.impactDependencies'), impact.dependencies.map(item => item.label))}
            {#if impact.sessions.length && !impact.targets.length}<p class="settings-row-meta">{$t('plugins.migrationTargetNeeded')}</p>{/if}
            {#if impact.active}<p class="settings-row-meta">{$t('plugins.activeTasks', { count: impact.active })} · {$t('plugins.stopBeforeUninstall')}</p>{/if}
            {#if impact.sessions.length}<p class="settings-row-meta">{$t('plugins.historyOnlyWarning')}</p>{/if}
            {#if impact.dependencies.length}<p role="alert">{$t('plugins.dependencyBlocker')}</p>{/if}
            <div class="settings-row-actions">
              {#each impact.targets as target}
                <Button disabled={busy || !impact.sessions.length} onclick={() => onMigrate?.(target.id)}>{$t('plugins.migrateTo', { name: target.label })}</Button>
              {/each}
              {#if impact.sessions.length || impact.bindings.length}
                <Button variant="destructive" disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(true)}>{$t('plugins.keepHistoryAndRemove')}</Button>
              {:else}
                <Button variant="destructive" disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(false)}>{$t('plugins.removeData')}</Button>
              {/if}
              <Button variant="ghost" disabled={busy} onclick={onRemovalCancel}>{$t('common.cancel')}</Button>
            </div>
          </section>
        {/if}
      {/if}

      {#if installedPlugins.length === 0}
        <p role="status">{$t('plugins.empty')}</p>
      {:else}
        <div class="plugin-browser" class:showing-detail={showingDetail}>
          <nav class="plugin-navigation" aria-label={$t('plugins.installedList')}>
            {#each installedPlugins as installation (installation.id)}
              <Button variant={selected?.id === installation.id ? 'secondary' : 'ghost'} aria-pressed={selected?.id === installation.id}
                aria-label={`${installation.manifest.displayName} · ${installation.pluginVersion}`}
                onclick={() => { selectedId = installation.id; showingDetail = true; }}>
                <span class="plugin-navigation-name">{installation.manifest.displayName}</span>
                <small class="settings-row-meta">{installation.pluginVersion}</small>
              </Button>
            {/each}
          </nav>
          <div class="plugin-detail">
            <div class="plugin-list-back"><Button variant="ghost" onclick={() => (showingDetail = false)}>{$t('plugins.back')}</Button></div>
          {#each installedPlugins as installation (installation.id)}
            {#if selected?.id === installation.id}
            {@const blocked = !installation.enabled && !installation.runnable}
            {@const settingsEntries = installation.contributions?.filter(entry => entry.metadata.settings || entry.metadata.kind === 'managementPanel') ?? []}
            {@const packageDependencies = installation.packageDependencies?.dependencies ?? []}
            <Card aria-label={installation.manifest.displayName}>
              <CardHeader class="settings-card-header">
                <div class="settings-copy">
                  <CardTitle>{installation.manifest.displayName}</CardTitle>
                  <p class="settings-row-meta">{installation.pluginId} · {installation.pluginVersion}</p>
                  {#if blocked}<p class="settings-row-meta" id={`${uid}-blocked`}>{$t('plugins.cannotEnable')}</p>{/if}
                </div>
                <label class="settings-switch">
                  <span>{$t('plugins.enable')}</span>
                  <input type="checkbox" role="switch" checked={installation.enabled} disabled={busy || blocked}
                    aria-describedby={blocked ? `${uid}-blocked` : undefined}
                    onchange={event => {
                      const checked = event.currentTarget.checked;
                      event.currentTarget.checked = installation.enabled;
                      onEnabledChange(installation.id, checked);
                    }} />
                </label>
              </CardHeader>
              <CardContent class="settings-card-content">
                {#if installation.dependencies.length || packageDependencies.length || installation.activationIssues?.length}
                  <section class="settings-block" aria-label={$t('plugins.dependenciesTitle')}>
                    <h4 class="settings-rows-title">{$t('plugins.dependenciesTitle')}</h4>
                    <div class="settings-rows" data-density="compact">
                      {#each installation.dependencies as dependency (`${dependency.kind}:${dependency.name}`)}
                        <div class="settings-row" role={dependency.required && !dependency.available ? 'alert' : undefined}>
                          <div class="settings-copy">
                            <span class="settings-row-title">{dependency.name}</span>
                            <span class="settings-row-meta">{meta(dependency.kind, dependency.required ? $t('plugins.dependencyRequired') : $t('plugins.dependencyOptional'), dependency.versionRange && $t('plugins.dependencyRequirement', { range: dependency.versionRange }), dependency.detectedVersion && $t('plugins.dependencyDetected', { version: dependency.detectedVersion }), !dependency.available && dependency.issue)}</span>
                          </div>
                          <Badge variant={statusVariant(dependency.available, dependency.required)}>{dependency.available ? $t('plugins.available') : $t('plugins.unavailable')}</Badge>
                        </div>
                      {/each}
                      {#each packageDependencies as dependency (dependency.pluginId)}
                        <div class="settings-row" role={dependency.required && !dependency.available ? 'alert' : 'status'}>
                          <div class="settings-copy">
                            <span class="settings-row-title">{dependency.pluginId}</span>
                            <span class="settings-row-meta">{meta($t('plugins.dependencyPlugin'), dependency.required ? $t('plugins.dependencyRequired') : $t('plugins.dependencyOptional'), dependency.version, !dependency.available && !dependency.required && $t('plugins.optionalMissingEffect'), dependency.issue)}</span>
                          </div>
                          <Badge variant={statusVariant(dependency.available, dependency.required)}>{dependency.available ? $t('plugins.available') : $t('plugins.unavailable')}</Badge>
                        </div>
                      {/each}
                      {#each installation.activationIssues ?? [] as issue}
                        <div class="settings-row" role="status"><span class="settings-row-meta">{issue}</span></div>
                      {/each}
                    </div>
                  </section>
                {/if}
                {#if installation.manifest.authentication}
                  {@const auth = authentication?.entries[installation.id]}
                  {@const authDisabled = busy || !installation.enabled || !installation.runnable}
                  <section class="settings-block" aria-label={$t('plugins.authTitle')}>
                    <h4 class="settings-rows-title">{$t('plugins.authTitle')}</h4>
                    <div class="settings-rows">
                      <div class="settings-row">
                        <div class="settings-copy">
                          <span class="settings-row-meta">{$t('plugins.authDescription')}</span>
                          {#if !installation.enabled}<span class="settings-row-meta">{$t('plugins.enableToLogin')}</span>{/if}
                          {#if authentication?.busyId === installation.id}<span class="settings-row-meta" role="status">{$t('plugins.authPending')}</span>{/if}
                          {#if auth?.error}<span class="settings-row-meta" role="alert">{translateMessage($locale, auth.error)}</span>
                          {:else if auth?.result === 'loginOpened'}<span class="settings-row-meta" role="status">{$t('plugins.loginOpened')}</span>
                          {:else if auth?.result === 'authenticated'}<span class="settings-row-meta" role="status">{$t('plugins.authenticated')}</span>
                          {:else if auth?.result === 'unauthenticated'}<span class="settings-row-meta" role="status">{$t('plugins.unauthenticated')}</span>{/if}
                        </div>
                        <div class="settings-row-actions">
                          <Button variant="ghost" size="sm" disabled={authDisabled} onclick={() => onAuthenticate?.(installation.id, 'status')}>{$t('plugins.checkLogin')}</Button>
                          <Button variant="outline" size="sm" disabled={authDisabled} onclick={() => onAuthenticate?.(installation.id, 'login')}>{$t('plugins.login')}</Button>
                        </div>
                      </div>
                    </div>
                  </section>
                {/if}
                {#if settingsEntries.length}
                  <section class="settings-block" aria-label={$t('plugins.contributionsTitle')}>
                    <h4 class="settings-rows-title">{$t('plugins.contributionsTitle')}</h4>
                    <div class="settings-rows" data-density="compact">
                      {#each settingsEntries as entry (entry.id)}
                        {@const name = String(entry.metadata.title ?? entry.metadata.displayName ?? entry.id)}
                        <div class="settings-row">
                          <div class="settings-copy"><span class="settings-row-title">{name}</span></div>
                          <div class="settings-row-actions">
                            <Button type="button" variant="outline" size="sm" aria-label={$t('plugins.settingsFor', { name })} disabled={busy || !installation.installed} onclick={() => onConfigure(installation.id, entry.id)}>{$t('plugins.openSettings')}</Button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  </section>
                {/if}
              </CardContent>
              <CardFooter class="settings-card-footer">
                <div class="settings-row-actions">
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onclick={() => onUninstall(installation.id)}>{$t('plugins.uninstall')}</Button>
                  {#if undoTargets.includes(installation.id)}<Button variant="ghost" size="sm" disabled={busy} onclick={()=>onUndo?.(installation.id)}>{$t('plugins.undoUpgrade')}</Button>{/if}
                </div>
                {#if installation.sessionProviders?.length}
                  <div class="settings-row-actions">
                    {#each installation.sessionProviders as provider (provider.id)}
                      <Button type="button" disabled={busy || !installation.installed || !installation.enabled || !installation.runnable} onclick={() => onCreateSession(installation.id, provider.id)}>{$t('plugins.createSession', { name: provider.displayName })}</Button>
                    {/each}
                  </div>
                {/if}
              </CardFooter>
            </Card>
            {/if}
          {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>

{#snippet impactGroup(title: string, items: string[])}
  {#if items.length}
    <div class="settings-block">
      {#if title}<h4 class="settings-rows-title">{title} <Badge variant="outline">{items.length}</Badge></h4>{/if}
      <ul class="settings-rows" data-density="compact">
        {#each items as item}<li class="settings-row"><span class="settings-row-title">{item}</span></li>{/each}
      </ul>
    </div>
  {/if}
{/snippet}

<style>
  .plugin-manager { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .plugin-browser { display: grid; grid-template-columns: minmax(160px, 200px) minmax(0, 1fr); gap: 16px; }
  .plugin-navigation { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .plugin-navigation :global(.ui-button[data-slot='button']) { justify-content: space-between; gap: 8px; }
  .plugin-navigation-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .plugin-detail { min-width: 0; }
  .plugin-list-back { display: none; }
  @media (max-width: 720px) {
    .plugin-browser { grid-template-columns: minmax(0, 1fr); }
    .plugin-browser:not(.showing-detail) .plugin-detail, .plugin-browser.showing-detail .plugin-navigation { display: none; }
    .plugin-list-back { display: block; margin-bottom: 8px; }
  }
</style>
