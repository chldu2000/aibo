<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '$lib/ui-kit';

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
    manifest: { displayName: string };
  };

  type Props = {
    installations: Installation[];
    packagePath: string;
    onPackagePathChange: (path: string) => void;
    busy: boolean;
    onInstall: () => void;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onUninstall: (id: string) => void;
    onConfigure: (installationId: string, contributionId: string) => void;
    onCreateSession: (installationId: string, agentId: string) => void;
  };

  let { installations, packagePath, onPackagePathChange, busy, onInstall, onEnabledChange, onUninstall, onCreateSession, onConfigure }: Props = $props();
  const fieldId = $props.id();
  let selectedId = $state<string | null>(null);
  const selected = $derived(installations.find(item => item.id === selectedId) ?? installations[0]);
  let showingDetail = $state(false);

</script>

<Card aria-label="插件" aria-busy={busy}>
  <CardHeader><CardTitle>插件</CardTitle></CardHeader>
  <CardContent>
    <div class="plugin-manager">
      <p>从本地解包目录安装插件，安装后默认禁用。启用前请确认来源可信：插件在独立进程运行，但不等于系统沙箱。</p>
      <form class="plugin-install" onsubmit={(event) => { event.preventDefault(); if (!busy && packagePath.trim()) onInstall(); }}>
        <Label for={fieldId}>插件解包目录</Label>
        <Input id={fieldId} value={packagePath} disabled={busy} placeholder="包含 plugin.json 的本地目录" oninput={(event: Event) => onPackagePathChange((event.currentTarget as HTMLInputElement).value)} />
        <Button type="submit" disabled={busy || !packagePath.trim()}>安装插件</Button>
      </form>

      {#if installations.length === 0}
        <p role="status">尚未安装外部插件。</p>
      {:else}
        <div class="plugin-browser" class:showing-detail={showingDetail}>
          <nav class="plugin-navigation" aria-label="已安装插件">
            {#each installations as installation (installation.id)}
              <Button variant={selected?.id === installation.id ? 'secondary' : 'ghost'} aria-pressed={selected?.id === installation.id}
                onclick={() => { selectedId = installation.id; showingDetail = true; }}>
                {installation.manifest.displayName} · {installation.pluginVersion}
              </Button>
            {/each}
          </nav>
          <div class="plugin-detail">
            <div class="plugin-list-back"><Button variant="ghost" onclick={() => (showingDetail = false)}>← 插件列表</Button></div>
          {#each installations as installation (installation.id)}
            {#if selected?.id === installation.id}
            <Card aria-label={installation.manifest.displayName}>
              <CardHeader>
                <div class="plugin-heading">
                  <CardTitle>{installation.manifest.displayName}</CardTitle>
                  <Badge>{!installation.installed ? '已卸载' : installation.enabled ? '已启用' : '已禁用'}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div class="plugin-details">
                  <p>{installation.pluginId} · {installation.pluginVersion}</p>
                  {#each installation.dependencies as dependency (`${dependency.kind}:${dependency.name}`)}
                    <p role={dependency.required && !dependency.available ? 'alert' : undefined}>
                      {dependency.kind} · {dependency.name}{dependency.versionRange ? ` ${dependency.versionRange}` : ''}{dependency.detectedVersion ? `（检测到 ${dependency.detectedVersion}）` : ''} · {dependency.available ? '可用' : dependency.required ? `不可用（必需${dependency.issue ? `：${dependency.issue}` : ''}）` : `不可用（可选${dependency.issue ? `：${dependency.issue}` : ''}）`}
                    </p>
                  {/each}
                  {#each installation.packageDependencies?.dependencies ?? [] as dependency (dependency.pluginId)}
                    <p role={dependency.required && !dependency.available ? 'alert' : 'status'}>
                      插件依赖 {dependency.pluginId}{dependency.version ? ` · ${dependency.version}` : ''}：{dependency.available ? '可用' : dependency.required ? '必需依赖不可用' : '可选依赖不可用，相关功能已停用'}{dependency.issue ? `（${dependency.issue}）` : ''}
                    </p>
                  {/each}
                  {#each installation.activationIssues ?? [] as issue}<p role="status">{issue}</p>{/each}
                  <div class="plugin-actions">
                    {#if installation.installed}
                      <Button type="button" variant="outline" disabled={busy || (!installation.enabled && !installation.runnable)} onclick={() => onEnabledChange(installation.id, !installation.enabled)}>{installation.enabled ? '禁用插件' : '启用插件'}</Button>
                      <Button type="button" variant="outline" disabled={busy} onclick={() => onUninstall(installation.id)}>卸载插件</Button>
                    {/if}
                    {#each installation.contributions?.filter(entry => entry.metadata.settings) ?? [] as entry (entry.id)}
                      <Button type="button" variant="outline" disabled={busy || !installation.installed} onclick={() => onConfigure(installation.id, entry.id)}>设置 · {String(entry.metadata.displayName ?? entry.id)}</Button>
                    {/each}
                    {#each installation.sessionProviders as provider (provider.id)}
                      <Button type="button" disabled={busy || !installation.installed || !installation.enabled || !installation.runnable} onclick={() => onCreateSession(installation.id, provider.id)}>新建 {provider.displayName} 会话</Button>
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
  .plugin-manager, .plugin-install, .plugin-details { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .plugin-heading, .plugin-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .plugin-install { align-items: stretch; }
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
