import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('sidebar renders projected Pi, Codex and external sessions in both skins', async (t) => {
  // Compile the real component and its UI kit through the application config.
  // Keep the renderer in the same module graph as the compiled components.
  const server = await createServer({
    server: { middlewareMode: true, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const { render } = await server.ssrLoadModule('svelte/server');
    const { default: Sidebar } = await server.ssrLoadModule('/src/lib/components/app/WorkspaceSidebar.svelte');
    const { toSessionListItemsByWorkspace } = await server.ssrLoadModule('/src/lib/components/app/view-models.ts');
    const { setUiKit } = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    const records = [
      ['dev.aibo.pi.agent', 'Pi regression'],
      ['dev.aibo.codex.agent', 'Codex regression'],
      ['external.echo.agent', 'External regression'],
    ].map(([agent, label], index) => ({
      id: `session-${index}`, workspaceId: 'workspace', agent, label,
      capabilities: [], state: 'idle', archived: false, updatedAt: '2026-09-10T00:00:00Z',
    }));
    const sessionsByWorkspace = toSessionListItemsByWorkspace({ workspace: records });
    assert.ok(sessionsByWorkspace.workspace.every((session) => !('capabilities' in session)));

    for (const kit of ['shadcn', 'material3']) {
      await t.test(kit, () => {
        setUiKit(kit);
        const props = {
          workspaces: [{ id: 'workspace', label: 'Workspace', path: '/tmp', trust: 'trusted' }],
          expandedWorkspaceIds: ['workspace'],
          sessionsByWorkspace: {},
          sessionsLoadingWorkspaceIds: ['workspace'],
        };
        assert.match(render(Sidebar, { props }).body, /加载会话/);
        props.sessionsByWorkspace = sessionsByWorkspace;
        // Loaded rows must render even during a background refresh.
        assert.match(render(Sidebar, { props }).body, /Pi regression/);
        props.sessionsLoadingWorkspaceIds = [];
        const loaded = render(Sidebar, { props }).body;
        for (const { label } of records) {
          assert.ok(loaded.includes(label));
        }
        assert.doesNotMatch(loaded, /加载会话|暂无会话/);
        assert.match(loaded, /agent-pi/);
        assert.match(loaded, /agent-codex/);
        assert.match(loaded, /agent-plugin/);
        props.expandedWorkspaceIds = [];
        assert.doesNotMatch(render(Sidebar, { props }).body, /Pi regression/);
        props.expandedWorkspaceIds = ['workspace'];
        assert.match(render(Sidebar, { props }).body, /Pi regression/);
      });
    }
  } finally {
    await server.close();
  }
});
