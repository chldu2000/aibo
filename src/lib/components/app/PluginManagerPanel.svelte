<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '$lib/ui-kit';

  type Installation = {
    id: string;
    pluginId: string;
    pluginVersion: string;
    enabled: boolean;
    installed: boolean;
    manifest: { displayName: string; agents: { agentId: string; displayName: string }[] };
  };

  type Props = {
    installations: Installation[];
    packagePath: string;
    onPackagePathChange: (path: string) => void;
    busy: boolean;
    onInstall: () => void;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onUninstall: (id: string) => void;
    onCreateSession: (installationId: string, agentId: string) => void;
  };

  let { installations, packagePath, onPackagePathChange, busy, onInstall, onEnabledChange, onUninstall, onCreateSession }: Props = $props();
  const fieldId = $props.id();
</script>

<Card aria-label="Agent 插件" aria-busy={busy}>
  <CardHeader><CardTitle>Agent 插件</CardTitle></CardHeader>
  <CardContent>
    <div class="plugin-manager">
      <p>从本地解包目录安装插件，安装后默认禁用。启用前请确认来源可信：插件在独立进程运行，但不等于系统沙箱。</p>
      <form class="plugin-install" onsubmit={(event) => { event.preventDefault(); if (!busy && packagePath.trim()) onInstall(); }}>
        <Label for={fieldId}>插件解包目录</Label>
        <Input id={fieldId} value={packagePath} disabled={busy} placeholder="包含 plugin.json 的本地目录" oninput={(event: Event) => onPackagePathChange((event.currentTarget as HTMLInputElement).value)} />
        <Button type="submit" disabled={busy || !packagePath.trim()}>安装插件</Button>
      </form>

      {#if installations.length === 0}
        <p role="status">尚未安装外部 Agent 插件。</p>
      {:else}
        <div class="plugin-list">
          {#each installations as installation (installation.id)}
            <Card>
              <CardHeader>
                <div class="plugin-heading">
                  <CardTitle>{installation.manifest.displayName}</CardTitle>
                  <Badge>{!installation.installed ? '已卸载' : installation.enabled ? '已启用' : '已禁用'}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div class="plugin-details">
                  <p>{installation.pluginId} · {installation.pluginVersion}</p>
                  <div class="plugin-actions">
                    {#if installation.installed}
                      <Button type="button" variant="outline" disabled={busy} onclick={() => onEnabledChange(installation.id, !installation.enabled)}>{installation.enabled ? '禁用插件' : '启用插件'}</Button>
                      <Button type="button" variant="outline" disabled={busy} onclick={() => onUninstall(installation.id)}>卸载插件</Button>
                    {/if}
                    {#each installation.manifest.agents as agent (agent.agentId)}
                      <Button type="button" disabled={busy || !installation.installed || !installation.enabled} onclick={() => onCreateSession(installation.id, agent.agentId)}>新建 {agent.displayName} 会话</Button>
                    {/each}
                  </div>
                </div>
              </CardContent>
            </Card>
          {/each}
        </div>
      {/if}
    </div>
  </CardContent>
</Card>

<style>
  .plugin-manager, .plugin-install, .plugin-list, .plugin-details { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .plugin-heading, .plugin-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .plugin-install { align-items: stretch; }
</style>
