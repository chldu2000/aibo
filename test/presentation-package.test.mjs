import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parsePresentationManifest, verifyPresentationPackage } from '../src/lib/presentation-runtime/package.ts';
import { validatorSource } from '../scripts/build-presentation-validator.mjs';

const theme = { id: 'ocean', label: 'Ocean', colorScheme: 'dark', tokens: { '--primary': '#123456' } };
const base = { schema: 'aibo.presentation-package/v1', id: 'dev.example.skin', version: '1.0.0', displayName: 'Example',
  hostApi: '1.0.0', coreSemantics: '1.0.0', snapshotSchemas: ['aibo.semantic-view/v1'], resources: [], themes: [theme], defaultThemeId: 'ocean' };
const script = new TextEncoder().encode('globalThis.skin = {};');
const resource = { path: 'skin.js', bytes: script.length, sha256: createHash('sha256').update(script).digest('hex'), mediaType: 'text/javascript' };
const executable = { ...base, resources: [resource], entry: 'skin.js', surfaces: ['workbench'] };

test('theme-only and executable workbench use the same package parser', async () => {
  assert.deepEqual(parsePresentationManifest(JSON.stringify(base)), base);
  const result = await verifyPresentationPackage(JSON.stringify(executable), async path => {
    assert.equal(path, 'skin.js'); return script;
  });
  assert.deepEqual(result.manifest, executable);
  assert.deepEqual(result.resources.get('skin.js'), script);
  assert.notEqual(result.resources.get('skin.js'), script);
});

test('incompatible versions, traversal, undeclared entry and oversized resources fail before reads', () => {
  const invalid = [
    { hostApi: '2.0.0' }, { coreSemantics: '2.0.0' }, { version: '01.0.0' },
    { snapshotSchemas: ['aibo.semantic-view/v1.1'] },
    { snapshotSchemas: ['aibo.semantic-view/v1', 'aibo.semantic-view/v1'] },
    { entry: 'missing.js', surfaces: ['workbench'] }, { entry: 'skin.js' },
    { resources: [{ ...resource, path: '../skin.js' }] },
    { resources: [{ ...resource, path: '/skin.js' }] },
    { resources: [{ ...resource, bytes: 8388609 }] },
    { entry: 'skin.js', surfaces: ['workbench'], resources: [resource, { ...resource, path: 'SKIN.js' }] },
    { arbitraryCode: 'oops' }, { resources: [resource] },
    { resources: Array.from({ length: 5 }, (_, i) => ({ ...resource, path: `asset${i}.png`, mediaType: 'image/png', bytes: 8388608 })) },
  ];
  for (const patch of invalid) assert.throws(() => parsePresentationManifest(JSON.stringify({ ...base, ...patch })), JSON.stringify(patch));
});

test('theme data rejects CSS injection, fetching functions and ambiguous IDs', () => {
  for (const value of ['url(https://example.com)', 'red;display:none', 'u\\72l(x)', '/*x*/red', 'image-set(x)', '</style>', 'var(--x, url(x))']) {
    assert.throws(() => parsePresentationManifest(JSON.stringify({ ...base, themes: [{ ...theme, tokens: { '--primary': value } }] })), value);
  }
  for (const patch of [{ defaultThemeId: 'missing' }, { themes: [theme, theme] }, { themes: [] }]) {
    assert.throws(() => parsePresentationManifest(JSON.stringify({ ...base, ...patch })));
  }
});

test('integrity is checked against actual resource bytes', async () => {
  await assert.rejects(verifyPresentationPackage(JSON.stringify(executable), async () => new Uint8Array()), /size_mismatch/);
  await assert.rejects(verifyPresentationPackage(JSON.stringify(executable), async () => new Uint8Array(script.length)), /integrity_mismatch/);
});

test('checked-in manifest validator matches schema and requires no runtime compiler', async () => {
  const generated = await validatorSource();
  assert.equal(await readFile('src/lib/presentation-runtime/package-validator.js', 'utf8'), generated);
  assert.doesNotMatch(generated, /require\(|\beval\(|new Function/);
});
