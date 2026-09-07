import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directApiImport = /from ['"][^'"]*\/api(?:\.ts)?['"]/;

async function sourceFiles(directory, extension) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(root, directory, entry.name));
}

test('app-level components use the UI kit seam', async () => {
  const files = await sourceFiles('src/lib/components/app', '.svelte');
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"]\$lib\/components\/ui(?:\/|['"])/,
      `${path.basename(file)} must not bind to a concrete UI implementation`,
    );
    assert.doesNotMatch(
      source,
      /from ['"](?:@lucide\/svelte|@ktibow\/iconset-material-symbols)/,
      `${path.basename(file)} must source visual icons through the kit seam`,
    );
    assert.match(
      source,
      /from ['"]\$lib\/ui-kit['"]|from ['"]\$lib\/ui-kit\//,
      `${path.basename(file)} must consume shared UI primitives through the kit seam`,
    );
    assert.doesNotMatch(
      source,
      directApiImport,
      `${path.basename(file)} must not call the API layer`,
    );
  }
});

test('root composition does not bind concrete visual implementations', async () => {
  const source = await readFile(path.join(root, 'src/App.svelte'), 'utf8');
  assert.doesNotMatch(
    source,
    /from ['"]\$lib\/components\/ui(?:\/|['"])/,
    'App.svelte must not bind to a concrete UI implementation',
  );
  assert.doesNotMatch(
    source,
    /from ['"](?:@lucide\/svelte|@ktibow\/iconset-material-symbols)/,
    'App.svelte must source visual icons through the kit seam',
  );
  assert.match(source, /from ['"]\$lib\/ui-kit['"]/, 'App.svelte must consume the UI kit seam');
});

test('desktop windows use Aibo-owned titlebar controls', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const windowsConfig = JSON.parse(
    await readFile(path.join(root, 'src-tauri', 'tauri.windows.conf.json'), 'utf8'),
  );
  assert.ok(config.app?.windows?.length > 0, 'Tauri must define at least one desktop window');
  assert.ok(
    config.app.windows.every((window) => window.decorations === true),
    'macOS must retain native window decorations for the traffic-light controls',
  );
  assert.ok(
    windowsConfig.app?.windows?.every((window) => window.decorations === false),
    'Windows must disable native decorations for the custom Aibo titlebar controls',
  );
  const titlebar = await readFile(path.join(root, 'src/lib/components/app/WindowTitlebar.svelte'), 'utf8');
  for (const callback of ['onMinimize', 'onToggleMaximize', 'onClose']) {
    assert.match(titlebar, new RegExp(`\\b${callback}\\b`), `${callback} must be wired in the custom titlebar`);
  }
  assert.match(titlebar, /\{#if !isMacOS\}/, 'custom window controls must not be rendered on macOS');
});

test('custom titlebar has permission for every native window action', async () => {
  const capability = JSON.parse(
    await readFile(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
  );
  const permissions = capability.permissions ?? [];
  for (const permission of [
    'core:window:allow-start-dragging',
    'core:window:allow-toggle-maximize',
    'core:window:allow-minimize',
    'core:window:allow-close',
  ]) {
    assert.ok(permissions.includes(permission), `${permission} must be granted to the titlebar`);
  }

  const titlebar = await readFile(path.join(root, 'src/lib/components/app/WindowTitlebar.svelte'), 'utf8');
  assert.match(
    titlebar,
    /data-tauri-drag-region/,
    'the titlebar must use Tauri drag-region handling for native window dragging',
  );
  assert.doesNotMatch(
    titlebar,
    /onmousedown=\{handleTitlebarMouseDown\}|ondblclick=/,
    'the titlebar must not compete with native drag or double-click handling',
  );
});

test('workspace Git file diffs render in the center preview', async () => {
  const [app, panel, preview] = await Promise.all([
    readFile(path.join(root, 'src/App.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/WorkspaceGitPanel.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/WorkspaceFileDiffPreview.svelte'), 'utf8'),
  ]);
  assert.match(app, /<WorkspaceFileDiffPreview/, 'App must render the file diff in the center column');
  assert.match(app, /workspaceFileDiffPath !== null/, 'the center preview must open for the selected file');
  assert.match(app, /selectedFilePath=\{workspaceFileDiffPath\}/, 'the Git panel must receive the selected file');
  assert.doesNotMatch(panel, /fileDiff(?:Loading|Error)?/, 'the Git panel must not render the file diff body');
  assert.match(preview, /workspace-file-diff-lines/, 'the center preview must render structured diff lines');
});

test('workspace and session rows expose only supported item actions', async () => {
  const sidebar = await readFile(path.join(root, 'src/lib/components/app/WorkspaceSidebar.svelte'), 'utf8');
  assert.doesNotMatch(sidebar, /在终端中打开|在编辑器中打开/, 'workspace rows must not expose terminal or editor actions');
  assert.doesNotMatch(sidebar, /关闭会话|onCloseSession/, 'session rows must not expose the close action');
  assert.doesNotMatch(sidebar, /onForkSession|创建分支/, 'session rows must not expose the Codex fork action');
  for (const platformLabel of ['Finder', '文件资源管理器', '文件管理器']) {
    assert.match(sidebar, new RegExp(`['"]${platformLabel}['"]`), `workspace location action must support ${platformLabel}`);
  }
  assert.match(sidebar, /workspaceLocationLabel/, 'workspace location action must use its platform label');
});

test('Codex forks are exposed in the timeline header and completed replies', async () => {
  const [panel, views] = await Promise.all([
    readFile(path.join(root, 'src/lib/components/app/TimelinePanel.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/view-types.ts'), 'utf8'),
  ]);
  assert.match(panel, /从最新完成的回复创建分支/, 'the timeline header must expose the latest-turn fork action');
  assert.match(panel, /从此回复创建会话分支/, 'completed Codex replies must expose a fork action');
  assert.match(panel, /lastCompletedAssistantByTurn\.set\(item\.turnId, item\.id\)/, 'each turn must select only its last completed Codex reply');
  assert.match(panel, /forkBoundaryMessageIds\.has\(item\.id\)/, 'reply forks must render only at the selected turn boundary');
  assert.match(views, /'turnId'/, 'timeline view items must retain their turn boundary');
});

test('Pi session tree opens as a graph overlay from the timeline heading', async () => {
  const [app, panel, overlay] = await Promise.all([
    readFile(path.join(root, 'src/App.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/TimelinePanel.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/PiSessionTreeOverlay.svelte'), 'utf8'),
  ]);
  assert.match(panel, /onOpenPiTree/, 'Pi sessions must expose the tree entry in the timeline heading');
  assert.match(app, /<PiSessionTreeOverlay/, 'the Pi tree must render as an app overlay');
  assert.doesNotMatch(app, /sidePanelView\s*=\s*['"]pi-tree['"]/, 'the Pi tree must not add a side-panel view');
  assert.match(overlay, /class="pi-tree-edges"/, 'the tree overlay must render graph edges');
  assert.match(overlay, /onSelectNode\(entry\.node\.id\)/, 'graph nodes must initiate navigation when clicked');
  assert.match(overlay, /pi-tree-navigation-status/, 'the tree graph must show navigation progress');
  assert.match(app, /if \(switched\) piTreeOpen = false/, 'a successful node switch must close the tree graph');
});

test('Pi tree navigation exposes all native summary modes', async () => {
  const [overlays, api, host] = await Promise.all([
    readFile(path.join(root, 'src/lib/components/app/AppOverlays.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/api.ts'), 'utf8'),
    readFile(path.join(root, 'src-tauri/pi-sdk-host.mjs'), 'utf8'),
  ]);
  for (const label of ['No Summary', 'Summarize', 'Summarize with custom prompt']) {
    assert.match(overlays, new RegExp(label), `Pi navigation must expose ${label}`);
  }
  assert.match(api, /summarize: options\.mode !== 'none'/, 'summary selection must reach the native command');
  assert.match(host, /customInstructions: customInstructions \|\| undefined/, 'custom summary instructions must reach Pi');
});

test('the diff preview monospace token is defined in the UI kit', async () => {
  const source = await readFile(path.join(root, 'src/lib/ui-kit/kits/base.css'), 'utf8');
  assert.match(source, /--aibo-mono\s*:/, 'the shared UI kit must define the diff monospace token');
  assert.match(
    source,
    /\.workspace-file-diff-line\s*\{[^}]*var\(--aibo-mono\)/s,
    'diff lines must use the shared monospace token',
  );
});

test('business modules do not depend on Svelte, UI, or API implementations', async () => {
  const files = await sourceFiles('src/lib/app', '.ts');
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /from ['"](?:svelte|@sveltejs\/|\$lib\/components(?:\/|['"]))/,
      `${path.basename(file)} must remain UI-framework independent`,
    );
    assert.doesNotMatch(
      source,
      directApiImport,
      `${path.basename(file)} must receive API dependencies through context`,
    );
  }
});

test('TimelinePanel forwards every required Composer callback from App', async () => {
  const [app, panel, composer] = await Promise.all([
    readFile(path.join(root, 'src/App.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/TimelinePanel.svelte'), 'utf8'),
    readFile(path.join(root, 'src/lib/components/app/Composer.svelte'), 'utf8'),
  ]);
  const props = composer.match(/type ComposerProps = \{([\s\S]*?)\n  \};/)[1];
  const panelBindings = panel.match(/let \{([\s\S]*?)\}: TimelinePanelProps = \$props\(\)/)[1];
  const composerElement = panel.slice(panel.indexOf('<Composer'));
  const panelElement = app.slice(app.indexOf('<TimelinePanel'));
  for (const [, callback] of props.matchAll(/\b(on\w+):/g)) {
    assert.match(panelBindings, new RegExp(`\\b${callback}\\b`), `${callback} must be received by TimelinePanel`);
    assert.match(composerElement, new RegExp(`${callback}=\\{${callback}\\}`), `${callback} must reach Composer`);
    assert.match(panelElement, new RegExp(`${callback}=\\{`), `${callback} must be supplied by App`);
  }
});
