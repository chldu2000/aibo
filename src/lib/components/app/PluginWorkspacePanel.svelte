<script lang="ts">
  import { Button, Card, CardContent, CardHeader, CardTitle, Label, PluginView, Textarea } from '$lib/ui-kit';
  import type { UiPluginViewDocument } from '$lib/ui-kit';
  import PluginManagerPanel from './PluginManagerPanel.svelte';
  import type { Session, TimelineItem } from '$lib/types';

  type Installation = { id: string; pluginId: string; pluginVersion: string; enabled: boolean; installed: boolean; runnable: boolean; dependencies: { kind: string; name: string; required: boolean; available: boolean; versionRange: string | null; detectedVersion?: string | null; issue?: string | null }[]; manifest: { displayName: string; agents: { agentId: string; displayName: string }[] } };
  type PluginSession = Omit<Session, 'agent'> & { agent: string };
  type Props = {
    installations: Installation[];
    sessions: PluginSession[];
    selectedSession: PluginSession | null;
    workspaceLabel: string | null;
    packagePath: string;
    prompt: string;
    timeline: TimelineItem[];
    views: UiPluginViewDocument[];
    busy: boolean;
    error: string;
    desktop: boolean;
    onPackagePathChange: (value: string) => void;
    onPromptChange: (value: string) => void;
    onInstall: () => void;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onUninstall: (id: string) => void;
    onCreateSession: (installationId: string, agentId: string) => void;
    onSelectSession: (id: string) => void;
    onSend: () => void;
    onCancel: () => void;
    onResume: () => void;
    onCloseSession: () => void;
    onViewAction: (viewId: string, actionId: string, input: Record<string, unknown>) => void;
    onClose: () => void;
  };
  let { installations, sessions, selectedSession, workspaceLabel, packagePath, prompt, timeline, views, busy, error, desktop, onPackagePathChange, onPromptChange, onInstall, onEnabledChange, onUninstall, onCreateSession, onSelectSession, onSend, onCancel, onResume, onCloseSession, onViewAction, onClose }: Props = $props();
  const promptId = $props.id();
  const running = $derived(selectedSession?.state === 'running' || selectedSession?.state === 'starting');
  const resumable = $derived(selectedSession?.state === 'interrupted' || selectedSession?.state === 'failed');
</script>

<section class="plugin-workspace" aria-label="插件工作台">
  <div class="plugin-toolbar"><h2>插件工作台 · {workspaceLabel ?? '请选择工作区'}</h2><Button variant="ghost" onclick={onClose}>返回会话</Button></div>
  {#if !desktop}<p role="status">插件需要在 Aibo 桌面应用中运行。</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <PluginManagerPanel {installations} {packagePath} {onPackagePathChange} busy={busy || !desktop} {onInstall} {onEnabledChange} {onUninstall} {onCreateSession} />
  <Card>
    <CardHeader><CardTitle>当前工作区的插件会话</CardTitle></CardHeader>
    <CardContent>
      <div class="plugin-sessions">
        {#each sessions as session (session.id)}
          <Button variant={session.id === selectedSession?.id ? 'secondary' : 'outline'} disabled={busy} onclick={() => onSelectSession(session.id)}>{session.label} · {session.state}</Button>
        {:else}<p>暂无插件会话。启用插件后即可新建。</p>{/each}
      </div>
    </CardContent>
  </Card>
  {#if selectedSession}
    <Card>
      <CardHeader><CardTitle>{selectedSession.label} · {selectedSession.state}</CardTitle></CardHeader>
      <CardContent>
        <div class="plugin-session-content">
          <div class="plugin-toolbar">
            <Button variant="outline" disabled={busy || !resumable} onclick={onResume}>恢复会话</Button>
            <Button variant="outline" disabled={busy || !running} onclick={onCancel}>停止</Button>
            <Button variant="outline" disabled={busy} onclick={onCloseSession}>关闭会话</Button>
          </div>
          <div class="plugin-timeline" role="log" aria-label="插件消息">
            {#each timeline as item (item.id)}
              <Card><CardHeader><CardTitle>{item.role} · {item.status}</CardTitle></CardHeader><CardContent>{item.content}</CardContent></Card>
            {/each}
          </div>
          {#each views as view (view.viewId)}
            <PluginView document={view} sessionId={selectedSession.id} disabled={busy} onAction={(actionId, input) => onViewAction(view.viewId, actionId, input)} />
          {/each}
          <form class="plugin-prompt" onsubmit={(event) => { event.preventDefault(); if (!busy && !running && prompt.trim()) onSend(); }}>
            <Label for={promptId}>发送给插件 Agent</Label>
            <Textarea id={promptId} value={prompt} disabled={busy || running} oninput={(event: Event) => onPromptChange((event.currentTarget as HTMLTextAreaElement).value)} />
            <Button type="submit" disabled={busy || running || !prompt.trim()}>发送</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  {/if}
</section>

<style>
  .plugin-workspace { display: flex; flex-direction: column; gap: 1rem; min-width: 0; min-height: 0; overflow: auto; padding: 1rem; }
  .plugin-toolbar, .plugin-sessions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .plugin-session-content, .plugin-timeline, .plugin-prompt { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
</style>
