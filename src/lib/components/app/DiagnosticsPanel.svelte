<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import type { Snippet } from 'svelte';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { AgentDiagnosticView } from './view-types';

  type DiagnosticsPanelProps = {
    presentationActions?: Snippet;
    open: boolean;
    embedded?: boolean;
    diagnostics: AgentDiagnosticView[];
    desktop: boolean;
    workspaceCount: number;
    sessionCount: number;
    busy: boolean;
    onRefresh: () => void;
    onClose: () => void;
  };

  let {
    presentationActions,
    open,
    embedded = false,
    diagnostics,
    desktop,
    workspaceCount,
    sessionCount,
    busy,
    onRefresh,
    onClose,
  }: DiagnosticsPanelProps = $props();

  const readyAgents = $derived(diagnostics.filter((agent) => agent.status === 'ready').length);
</script>

{#if open}
  <div class:settings-content={!embedded}>
    <div id="diagnostics-panel-content" class="settings-tab-panel" role="tabpanel" aria-label={$t('diagnostics.runtimeStatus')}>
      {@render presentationActions?.()}
      <section class="settings-section" aria-labelledby="agent-diagnostics-title">
        <div class="settings-section-heading">
          <div>
            <h2 id="agent-diagnostics-title">{$t('diagnostics.agents')}</h2>
            <p>{$t('diagnostics.description')}</p>
          </div>
          <Badge variant={diagnostics.length > 0 && readyAgents === diagnostics.length ? 'success' : 'warning'}>{$t('diagnostics.ready', { ready: readyAgents, total: diagnostics.length })}</Badge>
        </div>
        <div class="settings-agent-cards">
          {#each diagnostics as agent (agent.agent)}
            <Card as="article" class="agent-card">
              <CardHeader class="agent-card-head">
                <div class="agent-identity">
                  <div><strong>{agent.label}</strong><small>{agent.version ?? $t('inspector.noVersion')}</small></div>
                </div>
                <Badge variant={agent.status === 'ready' ? 'success' : 'warning'}>{agent.status === 'ready' ? $t('inspector.available') : agent.status === 'missing' ? $t('inspector.notInstalled') : agent.status === 'error' ? $t('inspector.error') : agent.status}</Badge>
              </CardHeader>
              <CardContent class="agent-card-content">
                <dl>
                  <div><dt>{$t('diagnostics.channel')}</dt><dd>{agent.agent === 'codex' ? 'app-server' : 'sdk-host'}</dd></div>
                  <div><dt>{$t('diagnostics.auth')}</dt><dd>{agent.authState === 'delegated' ? $t('diagnostics.systemCredentials') : agent.authState === 'not_required' ? $t('diagnostics.authNotRequired') : agent.authState === 'unknown' ? $t('diagnostics.authUnknown') : agent.authState}</dd></div>
                  {#if agent.executable}<div><dt>{$t('diagnostics.executable')}</dt><dd title={agent.executable}>{agent.executable}</dd></div>{/if}
                </dl>
                <div class="capability-list">
                  {#each agent.capabilities as capability}<Badge variant="outline">{capability}</Badge>{/each}
                </div>
              </CardContent>
            </Card>
          {/each}
        </div>
      </section>
      <Separator />
      <section class="settings-section" aria-labelledby="runtime-info-title">
        <div class="settings-section-heading">
          <div><h2 id="runtime-info-title">{$t('diagnostics.environment')}</h2></div>
        </div>
        <dl class="settings-runtime-list">
          <div><dt>{$t('diagnostics.platform')}</dt><dd>{desktop ? 'macOS · Tauri' : $t('diagnostics.web')}</dd></div>
          <div><dt>{$t('scope.workspace')}</dt><dd>{workspaceCount}</dd></div>
          <div><dt>{$t('scope.session')}</dt><dd>{sessionCount}</dd></div>
        </dl>
      </section>
    </div>
  </div>

  {#if !embedded}
  <div class="settings-footer">
    <Button variant="outline" size="sm" type="button" onclick={onRefresh} disabled={busy}>
      <Icon name="refresh" size={13} /> {$t('diagnostics.refresh')}
    </Button>
    <Button size="sm" type="button" onclick={onClose}>{$t('common.done')}</Button>
  </div>
  {/if}
{/if}
