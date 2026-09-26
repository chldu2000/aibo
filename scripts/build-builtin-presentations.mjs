import { readFile, writeFile } from 'node:fs/promises';

/** Built-in kits are preinstalled trusted releases; the manifest is projected from the kit catalog. */
export const builtinKits = ['material3', 'ak-ui'];
export const BUILTIN_PRESENTATION_PREFIX = 'dev.aibo.builtin.';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

export async function builtinManifestSource(kit) {
  const [metadata, host] = await Promise.all([
    read(`../src/lib/ui-kit/kits/${kit}/themes.json`),
    read('../src-tauri/tauri.conf.json'),
  ]);
  const manifest = {
    schema: 'aibo.presentation-package/v1',
    id: `${BUILTIN_PRESENTATION_PREFIX}${kit}`,
    version: host.version,
    displayName: metadata.label,
    hostApi: '1.0.0',
    coreSemantics: '1.0.0',
    snapshotSchemas: ['aibo.semantic-view/experimental-v1', 'aibo.semantic-view/v1', 'aibo.semantic-view/v1.1'],
    resources: [],
    themes: metadata.themes.map(({ id, label, colorScheme, tokens }) => ({ id, label, colorScheme, tokens })),
    defaultThemeId: metadata.defaultThemeId,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  for (const kit of builtinKits) {
    await writeFile(new URL(`../src/lib/ui-kit/kits/${kit}/presentation.json`, import.meta.url), await builtinManifestSource(kit));
  }
}
