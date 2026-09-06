<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { AgentDiagnosticView } from './view-types';

  type DiagnosticsPanelProps = {
    open: boolean;
    diagnostics: AgentDiagnosticView[];
    desktop: boolean;
    workspaceCount: number;
    sessionCount: number;
    busy: boolean;
    onRefresh: () => void;
    onClose: () => void;
  };

  let {
    open,
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
  <div class="settings-overlay" role="presentation" onclick={onClose}>
    <Card class="settings-panel diagnostics-panel" data-ui-component="diagnostics-panel" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="settings-header">
        <CardTitle id="diagnostics-title">Agent 诊断</CardTitle>
        <Button variant="ghost" size="icon" type="button" aria-label="关闭诊断" title="关闭" onclick={onClose}>
          <Icon name="close" size={16} />
        </Button>
      </CardHeader>
      <Separator />

      <div class="settings-content">
        <div id="diagnostics-panel-content" class="settings-tab-panel" role="tabpanel">
          <section class="settings-section" aria-labelledby="agent-diagnostics-title">
            <div class="settings-section-heading">
              <div>
                <h2 id="agent-diagnostics-title">Agent 状态</h2>
                <p>检查本机 Agent 连接与能力。</p>
              </div>
              <Badge variant={diagnostics.length > 0 && readyAgents === diagnostics.length ? 'success' : 'warning'}>{readyAgents}/{diagnostics.length} 就绪</Badge>
            </div>
            <div class="settings-agent-cards">
              {#each diagnostics as agent (agent.agent)}
                <Card as="article" class="agent-card">
                  <CardHeader class="agent-card-head">
                    <div class="agent-identity">
                      <div><strong>{agent.label}</strong><small>{agent.version ?? 'version unavailable'}</small></div>
                    </div>
                    <Badge variant={agent.status === 'ready' ? 'success' : 'warning'}>{agent.status}</Badge>
                  </CardHeader>
                  <CardContent class="agent-card-content">
                    <dl>
                      <div><dt>通道</dt><dd>{agent.agent === 'codex' ? 'app-server' : 'sdk-host'}</dd></div>
                      <div><dt>认证</dt><dd>{agent.authState === 'delegated' ? '系统凭据' : agent.authState}</dd></div>
                      {#if agent.executable}<div><dt>可执行文件</dt><dd title={agent.executable}>{agent.executable}</dd></div>{/if}
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
              <div><h2 id="runtime-info-title">运行环境</h2></div>
            </div>
            <dl class="settings-runtime-list">
              <div><dt>平台</dt><dd>{desktop ? 'macOS · Tauri' : 'Web 预览'}</dd></div>
              <div><dt>工作区</dt><dd>{workspaceCount}</dd></div>
              <div><dt>会话</dt><dd>{sessionCount}</dd></div>
            </dl>
          </section>
        </div>
      </div>

      <div class="settings-footer">
        <Button variant="outline" size="sm" type="button" onclick={onRefresh} disabled={busy}>
          <Icon name="refresh" size={13} /> 刷新诊断
        </Button>
        <Button size="sm" type="button" onclick={onClose}>完成</Button>
      </div>
    </Card>
  </div>
{/if}
