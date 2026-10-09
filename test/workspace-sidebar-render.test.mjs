import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { translate } from '../packages/i18n/index.js';

test('sidebar renders projected Pi, Codex and external sessions in both default themes', async (t) => {
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
    const { setUiTheme } = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    const { language } = await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
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

    for (const kit of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) {
      await t.test(`${kit} ${locale}`, () => {
        language.set({preference: locale, locale});
        setUiTheme(kit);
        const props = {
          workspaces: [{ id: 'workspace', label: 'Workspace', path: '/tmp', trust: 'trusted' }],
          expandedWorkspaceIds: ['workspace'],
          sessionsByWorkspace: {},
          sessionsLoadingWorkspaceIds: ['workspace'],
        };
        assert.ok(render(Sidebar, { props }).body.includes(translate(locale, 'sidebar.loading')));
        props.sessionsByWorkspace = sessionsByWorkspace;
        // Loaded rows must render even during a background refresh.
        assert.match(render(Sidebar, { props }).body, /Pi regression/);
        props.sessionsLoadingWorkspaceIds = [];
        const loaded = render(Sidebar, { props }).body;
        for (const { label } of records) {
          assert.ok(loaded.includes(label));
        }
        assert.ok(!loaded.includes(translate(locale, 'sidebar.loading')));
        assert.ok(!loaded.includes(translate(locale, 'sidebar.noSessions')));
        assert.match(loaded, /agent-pi/);
        assert.match(loaded, /agent-codex/);
        assert.match(loaded, /agent-plugin/);
        props.expandedWorkspaceIds = [];
        assert.doesNotMatch(render(Sidebar, { props }).body, /Pi regression/);
        props.expandedWorkspaceIds = ['workspace'];
        assert.match(render(Sidebar, { props }).body, /Pi regression/);
        props.sessionsByWorkspace = {
          workspace: Array.from({ length: 11 }, (_, index) => ({
            ...sessionsByWorkspace.workspace[0], id: `page-${index}`, label: `Paged session ${index + 1}!`,
          })),
        };
        const firstPage = render(Sidebar, { props }).body;
        assert.match(firstPage, /Paged session 5!/);
        assert.doesNotMatch(firstPage, /Paged session 6!/);
        assert.ok(firstPage.includes(translate(locale, 'sidebar.loadMore')));
        props.sessionVisibleCounts = { workspace: 10 };
        const secondPage = render(Sidebar, { props }).body;
        assert.match(secondPage, /Paged session 10!/);
        assert.doesNotMatch(secondPage, /Paged session 11!/);
        props.sessionVisibleCounts = { workspace: 15 };
        const lastPage = render(Sidebar, { props }).body;
        assert.match(lastPage, /Paged session 11!/);
        assert.ok(!lastPage.includes(translate(locale, 'sidebar.loadMore')));
      });
    }
  } finally {
    await server.close();
  }
});
