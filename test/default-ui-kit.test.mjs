import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('one default kit exposes both themes and legacy callers cannot restore retired defaults', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { get } = await server.ssrLoadModule('svelte/store');
    const registry = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    assert.deepEqual(registry.availableUiKits.map(kit => kit.id), ['ak-ui']);
    for (const theme of ['light', 'dark']) {
      registry.setUiTheme(theme);
      for (const legacy of ['shadcn', 'material3']) {
        registry.setUiKit(legacy);
        assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      }
      registry.setUiKit('external.unregistered');
      registry.setUiTheme('invalid');
      assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      assert.equal(get(registry.activeTheme).colorScheme, theme);
    }
    const adapter = get(registry.activeUiKit);
    for (const role of ['Button','AlertDialog','WorkbenchChrome','ManagementCenter','SemanticView','ModelMatrix','RepositorySelect','SessionControlMark','SubagentDialog','AttachmentList']) assert.equal(typeof adapter[role], 'function', role);
  } finally { await server.close(); }
});

test('retired built-in kits and their exclusive dependencies stay removed', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const kits = await readdir('src/lib/ui-kit/kits');
  for (const name of ['shadcn','material3','shadcn.ts','material3.ts','shadcn.css','material3.css','m3-functions.css']) assert(!kits.includes(name), name);
  const pkg = JSON.parse(await readFile('package.json','utf8'));
  for (const dependency of ['m3-svelte','@ktibow/iconset-material-symbols','@lucide/svelte','vite-plugin-functions-mixins','shadcn-svelte']) {
    assert(!pkg.dependencies?.[dependency] && !pkg.devDependencies?.[dependency], dependency);
  }
  async function inspect(directory) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inspect(file);
      else if (/\.(ts|svelte|css)$/.test(file)) {
        const source = await readFile(file,'utf8');
        assert.doesNotMatch(source, /(?:from|@import)\s*['"][^'"]*(?:kits\/(?:shadcn|material3)|\.\/(?:shadcn|material3)\/|m3-svelte|@lucide\/|@ktibow\/)/, file);
      }
    }
  }
  await inspect('src');
});

test('default themes keep secondary and warning text legible on their surfaces', async () => {
  const {readFile} = await import('node:fs/promises');
  const {themes} = JSON.parse(await readFile('src/lib/ui-kit/kits/ak-ui/themes.json','utf8'));
  const luminance = hex => {
    const [r,g,b] = hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return .2126*r+.7152*g+.0722*b;
  };
  for (const theme of themes) {
    const value = key => {const raw=theme.tokens[key];return raw.startsWith('var(')?value(raw.slice(4,-1)):raw};
    for (const [fg,bg] of [['--aibo-muted','--aibo-surface'],['--aibo-muted','--aibo-surface-hover'],['--aibo-warning-text','--aibo-warning-surface'],['--aibo-accent-text','--aibo-accent-soft']]) {
      const values=[luminance(value(fg)),luminance(value(bg))].sort((a,b)=>b-a);
      const ratio=(values[0]+.05)/(values[1]+.05);
      assert(ratio>=4.5, `${theme.id} ${fg} on ${bg}: ${ratio}`);
    }
  }
});
