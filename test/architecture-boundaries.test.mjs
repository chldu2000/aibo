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
  assert.ok(config.app?.windows?.length > 0, 'Tauri must define at least one desktop window');
  assert.ok(
    config.app.windows.every((window) => window.decorations === false),
    'native window decorations must be disabled for the custom Aibo titlebar',
  );
  const titlebar = await readFile(path.join(root, 'src/lib/components/app/WindowTitlebar.svelte'), 'utf8');
  for (const callback of ['onMinimize', 'onToggleMaximize', 'onClose']) {
    assert.match(titlebar, new RegExp(`\\b${callback}\\b`), `${callback} must be wired in the custom titlebar`);
  }
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
    'the titlebar must use Tauri drag-region handling for drag and double-click behavior',
  );
  assert.doesNotMatch(
    titlebar,
    /onmousedown=\{handleTitlebarMouseDown\}|ondblclick=\{handleTitlebarDoubleClick\}/,
    'the titlebar must not compete with Tauri drag-region event handling',
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
