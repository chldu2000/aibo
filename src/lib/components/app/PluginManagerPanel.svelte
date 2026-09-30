<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '$lib/ui-kit';
  import type { PluginLifecycleState, PluginUpgradePolicy } from '$lib/app/plugin-lifecycle-controller';

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
    manifest: { displayName: string };
  };

  type Props = {
    installation?: PluginInstallState;
    onInstallConfirm?: (reinstall:boolean)=>void;
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
    onPolicyChange?: (policy: PluginUpgradePolicy) => void;
    onRemovalCancel?: () => void;
    onRemovalConfirm?: (keepHistory: boolean) => void;
    onMigrate?: (target: string) => void;
  };

  let { installation, onInstallConfirm, onInstallCancel, onUndo, installations, busy, onInstall, onEnabledChange, onUninstall, onCreateSession, onConfigure, lifecycle, onPolicyChange, onRemovalCancel, onRemovalConfirm, onMigrate }: Props = $props();
  let selectedId = $state<string | null>(null);
  const installedPlugins = $derived(installations.filter(item => item.installed));
  const selected = $derived(installedPlugins.find(item => item.id === selectedId) ?? installedPlugins[0]);
  const undoTargets = $derived(installation?.undoTargets ?? []);
  let showingDetail = $state(false);

</script>

<Card aria-label="插件" aria-busy={busy}>
  <CardHeader><CardTitle>插件</CardTitle></CardHeader>
  <CardContent>
    <div class="plugin-manager">
      <p>同一插件只保留一个当前版本。首次安装默认禁用；替换已启用的插件会恢复其会话并继续启用。安装前请确认来源可信。</p>
      {#if installation?.error}<p role="alert">{installation.error}</p>{/if}
      {#if installation?.notice}<p role="status">{installation.notice}</p>{/if}
      {#if installation?.preview}
        {@const preview=installation.preview}
        <section aria-label="安装影响" class="plugin-details">
          <h3>{preview.kind === 'downgrade' ? '降级重装' : preview.kind === 'replace' ? '替换安装' : preview.kind === 'upgrade' ? '升级插件' : '安装插件'} · {preview.pluginId}</h3>
          <p>{preview.previous.length ? `${preview.previous.join('、')} → ` : ''}{preview.version}</p>
          {#each preview.impacts as impact}
            <p>引用会话 {impact.sessions.length} 个 · 能力绑定 {impact.bindings.length} 个 · 依赖插件 {impact.dependencies.length} 个</p>
            {#each impact.sessions as session}<p>会话：{session.label}</p>{/each}
            {#each impact.bindings as binding}<p>能力绑定：{binding.label}</p>{/each}
            {#each impact.dependencies as dependency}<p>依赖插件：{dependency.label}</p>{/each}
          {/each}
          {#each preview.blockers as blocker}<p role="alert">{blocker}</p>{/each}
          {#if preview.kind === 'downgrade'}
            <p role="alert">旧版不能安全读取新版数据。重装会清除插件私有数据、缓存和全局及项目配置；原会话仅保留历史，不能继续。安装后默认禁用，需要新建会话。</p>
          {:else if preview.previous.length}
            <p>全部会话恢复和引用检查成功后才替换，失败保留旧版。旧版暂作撤销备份；新版开始调用或产生新数据后，备份会清理，不能再撤销。</p>
          {/if}
          <div class="plugin-actions">
            <Button disabled={busy || !!preview.blockers.length} onclick={()=>onInstallConfirm?.(preview.kind === 'downgrade')}>{preview.kind === 'downgrade' ? '清除插件数据并安装旧版' : '确认安装'}</Button>
            <Button variant="outline" disabled={busy} onclick={onInstallCancel}>取消</Button>
          </div>
        </section>
      {/if}
      {#if lifecycle}
        {#if lifecycle.error}<p role="alert">{lifecycle.error}</p>{/if}
        {#if lifecycle.report}
          <p role="status">已迁移 {lifecycle.report.migrated.length} 个会话；{lifecycle.report.failed.length} 个会话保留原版本。</p>
          {#each lifecycle.report.failed as item}<p>{item.label}</p>{/each}
        {/if}
        {#if lifecycle.impact}
          {@const impact = lifecycle.impact}
          <section aria-label="卸载影响" class="plugin-details">
            <h3>卸载 {installations.find(item => item.id === impact.id)?.manifest.displayName} · {installations.find(item => item.id === impact.id)?.pluginVersion}</h3>
            <p>将删除此版本的程序文件、私有数据和缓存。消息、附件、执行记录和历史配置快照会保留。</p>
            <p>会话 {impact.sessions.length} 个 · 能力绑定 {impact.bindings.length} 个 · 依赖插件 {impact.dependencies.length} 个 · 正在运行 {impact.active} 项</p>
            {#each impact.sessions as item}<p>会话：{item.label}（{item.id}）</p>{/each}
            {#each impact.bindings as item}<p>能力绑定：{item.label}</p>{/each}
            {#each impact.dependencies as item}<p>依赖插件：{item.label}</p>{/each}
            {#if impact.dependencies.length}<p role="alert">请先卸载或重新绑定依赖插件，再卸载此版本。</p>{/if}
            {#if impact.sessions.length && !impact.targets.length}<p>如需继续这些会话，请先安装并启用更高版本，再尝试迁移。</p>{/if}
            {#if impact.active}<p>确认卸载后会先停止任务，等待进程退出，再清理数据。</p>{/if}
            <div class="plugin-actions">
              {#each impact.targets as target}
                <Button disabled={busy || !impact.sessions.length} onclick={() => onMigrate?.(target.id)}>迁移到 {target.label}</Button>
              {/each}
              {#if impact.sessions.length || impact.bindings.length}
                <Button disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(true)}>保留历史并停用，清除插件数据</Button>
              {:else}
                <Button disabled={busy || impact.dependencies.length > 0} onclick={() => onRemovalConfirm?.(false)}>卸载并清除数据</Button>
              {/if}
              <Button variant="outline" disabled={busy} onclick={onRemovalCancel}>取消</Button>
            </div>
            {#if impact.sessions.length}<p>选择保留历史并停用后，这些会话将不能继续，即使重新安装此版本。</p>{/if}
          </section>
        {/if}
      {/if}
      <div class="plugin-actions">
        <Button type="button" variant="outline" disabled={busy} onclick={onInstall}>选择目录安装</Button>
      </div>

      {#if installedPlugins.length === 0}
        <p role="status">尚未安装外部插件。</p>
      {:else}
        <div class="plugin-browser" class:showing-detail={showingDetail}>
          <nav class="plugin-navigation" aria-label="已安装插件">
            {#each installedPlugins as installation (installation.id)}
              <Button variant={selected?.id === installation.id ? 'secondary' : 'ghost'} aria-pressed={selected?.id === installation.id}
                onclick={() => { selectedId = installation.id; showingDetail = true; }}>
                {installation.manifest.displayName} · {installation.pluginVersion}
              </Button>
            {/each}
          </nav>
          <div class="plugin-detail">
            <div class="plugin-list-back"><Button variant="ghost" onclick={() => (showingDetail = false)}>← 插件列表</Button></div>
          {#each installedPlugins as installation (installation.id)}
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
                      {#if undoTargets.includes(installation.id)}<Button variant="outline" disabled={busy} onclick={()=>onUndo?.(installation.id)}>撤销本次升级</Button>{/if}
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
