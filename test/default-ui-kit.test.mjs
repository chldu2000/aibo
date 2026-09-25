import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('built-in kits expose both themes, preserve brightness, and use Material 3 as the default', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { get } = await server.ssrLoadModule('svelte/store');
    const registry = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    assert.deepEqual(registry.availableUiKits.map(kit => kit.id), ['material3', 'ak-ui']);
    assert.equal(registry.defaultUiKitId, 'material3');
    assert.deepEqual(get(registry.appearanceSelection), {kitId:'material3',themeId:'light'});
    assert.equal(get(registry.activePresentationPlugin).id, 'material3');
    registry.setUiKit('ak-ui');
    for (const theme of ['light', 'dark']) {
      registry.setUiTheme(theme);
      for (const legacy of ['shadcn']) {
        registry.setUiKit(legacy);
        assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      }
      registry.setUiKit('external.unregistered');
      registry.setUiTheme('invalid');
      assert.deepEqual(get(registry.appearanceSelection), { kitId: 'ak-ui', themeId: theme });
      assert.equal(get(registry.activeTheme).colorScheme, theme);
    }
    const adapter = get(registry.activeUiKit);
    for (const theme of ['light', 'dark']) {
      registry.setUiTheme(theme);
      registry.setUiKit('material3');
      assert.deepEqual(get(registry.appearanceSelection), {kitId:'material3', themeId:theme});
      assert.equal(get(registry.activePresentationPlugin).id, 'material3');
      for (const role of Object.keys(adapter).filter(role => !['Icon', 'AgentStatusMark'].includes(role))) assert.equal(get(registry.activeUiKit)[role], adapter[role], `${role} preserves its component identity`);
      for (const role of ['Icon', 'AgentStatusMark']) assert.notEqual(get(registry.activeUiKit)[role], adapter[role], `${role} artwork is kit-owned`);
      registry.setUiKit('unregistered'); registry.setUiTheme('ocean');
      assert.deepEqual(get(registry.appearanceSelection), {kitId:'material3', themeId:theme});
      registry.setUiKit('ak-ui');
      assert.deepEqual(get(registry.appearanceSelection), {kitId:'ak-ui', themeId:theme});
    }
    for (const palette of ['forest', 'plum']) {
      registry.setUiKit('material3');
      registry.setUiTheme(`${palette}-light`);
      registry.toggleUiColorScheme();
      assert.deepEqual(get(registry.appearanceSelection), {kitId:'material3', themeId:`${palette}-dark`});
      registry.toggleUiColorScheme();
      assert.equal(get(registry.activeTheme).id, `${palette}-light`);
    }
    registry.setUiKit('ak-ui');
    registry.toggleUiColorScheme();
    assert.equal(get(registry.activeTheme).id, 'dark');
    assert.deepEqual(registry.availableUiKits.find(kit => kit.id === 'ak-ui').themes.map(theme => theme.id), ['light', 'dark']);
    for (const role of ['Button','AlertDialog','WorkbenchChrome','ManagementCenter','SemanticView','ModelMatrix','RepositorySelect','SessionControlMark','SubagentDialog','AttachmentList']) assert.equal(typeof adapter[role], 'function', role);
  } finally { await server.close(); }
});

test('retired implementations and their exclusive dependencies stay removed', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const kits = await readdir('src/lib/ui-kit/kits');
  for (const name of ['shadcn','shadcn.ts','shadcn.css','m3-functions.css']) assert(!kits.includes(name), name);
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
        assert.doesNotMatch(source, /(?:from|@import)\s*['"][^'"]*(?:kits\/shadcn|\.\/shadcn\/|m3-svelte|@lucide\/|@ktibow\/)/, file);
      }
    }
  }
  await inspect('src');
});

test('default themes keep secondary and warning text legible on their surfaces', async () => {
  const {readFile} = await import('node:fs/promises');
  const {themes} = JSON.parse(await readFile('src/lib/ui-kit/kits/ak-ui/themes.json','utf8'));
  const palette = Object.fromEntries([...(await readFile('node_modules/@yunyoujun/ak-ui/dist/tokens.css','utf8')).matchAll(/(--ak-[\w-]+):\s*([^;]+);/g)].map(([,key,value])=>[key,value.trim()]));
  const luminance = hex => {
    if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c=>c+c).join('');
    const [r,g,b] = hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return .2126*r+.7152*g+.0722*b;
  };
  for (const theme of themes) {
    const value = key => {const raw=theme.tokens[key] ?? palette[key];return raw.startsWith('var(')?value(raw.slice(4,-1)):raw};
    for (const [fg,bg] of [['--aibo-muted','--aibo-surface'],['--aibo-muted','--aibo-surface-hover'],['--aibo-warning-text','--aibo-warning-surface'],['--aibo-accent-text','--aibo-accent-soft'],['--aibo-text','--ak-surface-raised'],['--aibo-muted','--ak-surface-raised'],['--aibo-info-text','--aibo-info-surface'],['--aibo-success-text','--aibo-success-surface'],['--aibo-danger-text','--aibo-danger-surface'],['--aibo-action-text','--ak-signal-action'],['--aibo-text','--aibo-selected']]) {
      const values=[luminance(value(fg)),luminance(value(bg))].sort((a,b)=>b-a);
      const ratio=(values[0]+.05)/(values[1]+.05);
      assert(ratio>=4.5, `${theme.id} ${fg} on ${bg}: ${ratio}`);
    }
    for (const surface of ['canvas','panel','muted','raised']) {
      const values=[luminance(value('--ak-focus-color')),luminance(value(`--ak-surface-${surface}`))].sort((a,b)=>b-a);
      assert((values[0]+.05)/(values[1]+.05)>=3, `${theme.id} focus on ${surface}`);
    }
  }
});


test('default theme surfaces and functional signals have distinct roles', async () => {
  const {readFile} = await import('node:fs/promises');
  const {themes} = JSON.parse(await readFile('src/lib/ui-kit/kits/ak-ui/themes.json','utf8'));
  for (const {tokens, id} of themes) {
    const surfaces=['canvas','panel','muted','raised'].map(role=>tokens[`--ak-surface-${role}`]);
    assert.equal(new Set(surfaces).size,4,id);
    const signals=['info','action','accent','success','danger'].map(role=>tokens[`--ak-signal-${role}`]);
    assert.equal(new Set(signals).size,5,id);
    assert.notEqual(tokens['--aibo-warning-surface'],tokens['--aibo-selected'],'warning is not navigation selection');
  }
});


test('blue and yellow use the installed ak-ui palette, with theme-appropriate focus', async () => {
  const {readFile} = await import('node:fs/promises');
  const {themes} = JSON.parse(await readFile('src/lib/ui-kit/kits/ak-ui/themes.json','utf8'));
  for (const {tokens,id} of themes) {
    assert.equal(tokens['--ak-signal-info'],'var(--ak-color-blue)');
    assert.equal(tokens['--ak-signal-action'],'var(--ak-color-yellow)');
    assert.equal(tokens['--ak-focus-color'],id==='light'?'var(--ak-color-dark-blue)':'var(--ak-color-blue)');
    assert.equal(tokens['--ak-surface-canvas'],id==='light'?'#e9ebe7':'#111315');
  }
});
