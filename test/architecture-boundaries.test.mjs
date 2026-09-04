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
