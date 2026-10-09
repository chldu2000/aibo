import { translateMessage } from '../packages/i18n/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { parsePresentationManifest } from '../packages/presentation-tools/manifest.js';
import { BUILTIN_PRESENTATION_PREFIX, builtinKits, builtinManifestSource } from '../scripts/build-builtin-presentations.mjs';
import { builtinAppearance, builtinSelection } from '../src/lib/app/builtin-presentation.ts';

test('built-in manifests are generated from the kit catalogs and pass the external package contract', async () => {
  for (const kit of builtinKits) {
    const source = await readFile(`src/lib/ui-kit/kits/${kit}/presentation.json`, 'utf8');
    assert.equal(source, await builtinManifestSource(kit), `run pnpm run generate:builtin-presentations for ${kit}`);
    const manifest = parsePresentationManifest(source);
    assert.equal(manifest.id, `${BUILTIN_PRESENTATION_PREFIX}${kit}`);
    assert.deepEqual(manifest.resources, [], 'built-in code ships with the host, not as package resources');
    assert.equal(manifest.entry, undefined);
  }
  const rust = await readFile('src-tauri/src/presentation_packages.rs', 'utf8');
  for (const kit of builtinKits) assert.ok(rust.includes(`kits/${kit}/presentation.json`), `${kit} is registered by the host`);
  assert.ok(rust.includes(`"${BUILTIN_PRESENTATION_PREFIX}"`), 'host reserves the same identity prefix');
});

test('kit registrations merge foundation tokens so every theme keeps the complete token set', async () => {
  const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const registry = await server.ssrLoadModule('/src/lib/ui-kit/registry.ts');
    const catalog = await server.ssrLoadModule('/src/lib/ui-kit/kits/theme-catalog.ts');
    assert.equal(catalog.BUILTIN_PRESENTATION_PREFIX, BUILTIN_PRESENTATION_PREFIX);
    for (const kit of registry.availableUiKits) {
      const source = JSON.parse(await readFile(`src/lib/ui-kit/kits/${kit.id}/themes.json`, 'utf8'));
      assert.equal(kit.packageId, `${BUILTIN_PRESENTATION_PREFIX}${kit.id}`);
      for (const theme of kit.themes) {
        const declared = source.themes.find(candidate => candidate.id === theme.id);
        assert.deepEqual(theme.tokens, { ...source.tokens, ...declared.tokens });
      }
      const keys = new Set(kit.themes.map(theme => Object.keys(theme.tokens).sort().join()));
      assert.equal(keys.size, 1, `${kit.id} themes expose the same tokens`);
    }
  } finally { await server.close(); }
});

test('only host-marked built-in releases resolve to compiled kits', () => {
  const kits = [{ id: 'material3', packageId: 'dev.aibo.builtin.material3', defaultThemeId: 'light', themes: [{ id: 'light' }, { id: 'dark' }] }];
  const manifest = { id: 'dev.aibo.builtin.material3' };
  const builtin = { digest: 'b', enabled: true, source: 'builtin', manifest };
  const local = { digest: 'l', enabled: true, source: 'local', manifest };
  assert.deepEqual(builtinSelection([local, builtin], kits, { kitId: 'material3', themeId: 'dark' }), { digest: 'b', themeId: 'dark' });
  assert.equal(builtinSelection([local], kits, { kitId: 'material3', themeId: 'dark' }), null);
  assert.equal(builtinSelection([{ ...builtin, enabled: false }], kits, { kitId: 'material3', themeId: 'dark' }), null);
  assert.deepEqual(builtinAppearance(builtin, null, kits), { kitId: 'material3', themeId: 'light' });
  assert.throws(() => builtinAppearance(local, 'dark', kits), /presentation_unavailable/);
  assert.throws(() => builtinAppearance({ ...builtin, source: undefined }, 'dark', kits), /presentation_unavailable/);
  assert.throws(() => builtinAppearance(builtin, 'missing', kits), /invalid_presentation_theme/);
  const original=structuredClone({builtin,local,kits});
  for(const [release,theme,key,diagnostic] of [[local,'dark','native.presentation.unavailable','presentation_unavailable'],[builtin,'missing','presentation.invalidTheme','invalid_presentation_theme']]){
    assert.throws(()=>builtinAppearance(release,theme,kits),error=>{
      assert.equal(error.message,diagnostic);assert.equal(error.localized.key,key);
      for(const locale of ['en','zh-CN'])assert.notEqual(translateMessage(locale,error.localized),diagnostic);
      return true;
    });
  }
  assert.deepEqual({builtin,local,kits},original);
  assert.deepEqual(builtinAppearance(builtin,'dark',kits),{kitId:'material3',themeId:'dark'});

});
