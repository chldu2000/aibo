<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Icon, Separator } from '$lib/ui-kit';
  import type { UiKitOption } from '$lib/ui-kit';
  import type { AgentDiagnosticView } from './view-types';

  type SettingsTab = 'appearance' | 'diagnostics';

  type SettingsPanelProps = {
    open: boolean;
    diagnostics: AgentDiagnosticView[];
    desktop: boolean;
    workspaceCount: number;
    sessionCount: number;
    busy: boolean;
    uiKits: readonly UiKitOption[];
    activeUiKitName: string;
    activeThemeId: string;
    onSelectUiKit: (kitId: string) => void;
    onSelectTheme: (themeId: string) => void;
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
    uiKits,
    activeUiKitName,
    activeThemeId,
    onSelectUiKit,
    onSelectTheme,
    onRefresh,
    onClose,
  }: SettingsPanelProps = $props();

  let activeTab = $state<SettingsTab>('appearance');
  const readyAgents = $derived(diagnostics.filter((agent) => agent.status === 'ready').length);
  const activeKit = $derived(uiKits.find((kit) => kit.id === activeUiKitName) ?? uiKits[0]);
</script>

{#if open}
  <div class="settings-overlay" role="presentation" onclick={onClose}>
    <Card class="settings-panel" data-ui-component="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="settings-header">
        <CardTitle id="settings-title">设置</CardTitle>
        <Button variant="ghost" size="icon" type="button" aria-label="关闭设置" title="关闭" onclick={onClose}>
          <Icon name="close" size={16} />
        </Button>
      </CardHeader>

      <div class="settings-tabs" role="tablist" aria-label="设置分类">
        <button
          class:active={activeTab === 'appearance'}
          class="settings-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'appearance'}
          aria-controls="appearance-settings"
          onclick={() => (activeTab = 'appearance')}
        >外观</button>
        <button
          class:active={activeTab === 'diagnostics'}
          class="settings-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'diagnostics'}
          aria-controls="diagnostics-settings"
          onclick={() => (activeTab = 'diagnostics')}
        >诊断</button>
      </div>
      <Separator />

      <div class="settings-content">
        {#if activeTab === 'appearance'}
          <div id="appearance-settings" class="settings-tab-panel" role="tabpanel">
            <section class="settings-section" aria-labelledby="ui-kit-title">
              <div class="settings-section-heading">
                <div>
                  <h2 id="ui-kit-title">界面皮肤</h2>
                  <p>切换会立即应用，并在下次启动时恢复。</p>
                </div>
              </div>
              <div class="appearance-kit-grid">
                {#each uiKits as kit (kit.id)}
                  <button
                    class:active={kit.id === activeUiKitName}
                    class="appearance-kit-option"
                    type="button"
                    aria-pressed={kit.id === activeUiKitName}
                    onclick={() => onSelectUiKit(kit.id)}
                  >
                    <span class="appearance-option-heading">
                      <strong>{kit.label}</strong>
                      {#if kit.id === activeUiKitName}<Icon name="check" size={15} />{/if}
                    </span>
                    <small>{kit.description}</small>
                  </button>
                {/each}
              </div>
            </section>

            <Separator />

            <section class="settings-section" aria-labelledby="theme-color-title">
              <div class="settings-section-heading">
                <div>
                  <h2 id="theme-color-title">主题色</h2>
                  <p>颜色方案由当前皮肤提供。</p>
                </div>
              </div>
              <div class="appearance-theme-grid">
                {#each activeKit?.themes ?? [] as theme (theme.id)}
                  <button
                    class:active={theme.id === activeThemeId}
                    class="appearance-theme-option"
                    type="button"
                    aria-pressed={theme.id === activeThemeId}
                    onclick={() => onSelectTheme(theme.id)}
                  >
                    <span class="theme-swatches" aria-hidden="true">
                      {#each theme.swatches as swatch}<i style:background={swatch}></i>{/each}
                    </span>
                    <span class="theme-option-copy">
                      <strong>{theme.label}</strong>
                      <small>{theme.description}</small>
                    </span>
                    {#if theme.id === activeThemeId}<Icon name="check" size={15} />{/if}
                  </button>
                {/each}
              </div>
            </section>
          </div>
        {:else}
          <div id="diagnostics-settings" class="settings-tab-panel" role="tabpanel">
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
        {/if}
      </div>
      <div class="settings-footer">
        {#if activeTab === 'diagnostics'}
          <Button variant="outline" size="sm" type="button" onclick={onRefresh} disabled={busy}>
            <Icon name="refresh" size={13} /> 刷新诊断
          </Button>
        {/if}
        <Button size="sm" type="button" onclick={onClose}>完成</Button>
      </div>
    </Card>
  </div>
{/if}
