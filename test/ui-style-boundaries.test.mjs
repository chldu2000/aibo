import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const visualDeclaration = /\b(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|color|style|width))?|border-radius|box-shadow|font(?:-[a-z-]+)?|text-shadow|outline(?:-[a-z-]+)?|opacity|filter|fill|stroke|transition|animation|appearance)\s*:/;
const skinIdentifier = /(?:^|[\s'".(])(?:m3|material3|shadcn)(?:[-_'".)]|$)|--(?:m3c|shadcn)-/;
const skinToken = /--aibo-(?:bg|text|muted|subtle|border|surface|accent|focus|success|warning|danger)(?:-|\s*:)/;

async function appComponents() {
  const directory = path.join(root, 'src/lib/components/app');
  const entries = await readdir(directory, { withFileTypes: true });
  return [path.join(root, 'src/App.svelte'), ...entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
    .map((entry) => path.join(directory, entry.name))];
}

function gitDiff(...args) {
  try {
    return execFileSync('git', ['diff', '--unified=0', ...args], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    if (error.status === 1) return error.stdout ?? '';
    return '';
  }
}

function addedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

test('app components do not contain skin-specific visual styles', async () => {
  for (const file of await appComponents()) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    for (const [, style] of styleBlocks) {
      assert.doesNotMatch(style, visualDeclaration, `${relative} must keep visual CSS in the active skin`);
      assert.doesNotMatch(style, skinIdentifier, `${relative} must not name a concrete skin`);
    }
    if (relative !== 'src/App.svelte') {
      assert.doesNotMatch(source, skinIdentifier, `${relative} must not branch on a concrete skin`);
    }
  }
});

test('new app-layer changes do not add skin-owned CSS', () => {
  const paths = [
    'src/app.css',
    'src/App.svelte',
    'src/lib/components/app',
  ];
  const unstaged = addedLines(gitDiff('--', ...paths));
  const staged = addedLines(gitDiff('--cached', '--', ...paths));
  const changed = [...unstaged, ...staged];
  if (changed.length === 0) {
    const base = process.env.AIBO_BASE_REF;
    if (base) changed.push(...addedLines(gitDiff(`${base}...HEAD`, '--', ...paths)));
    else changed.push(...addedLines(gitDiff('HEAD^', '--', ...paths)));
  }
  const violations = changed.filter((line) =>
    visualDeclaration.test(line) || skinIdentifier.test(line) || skinToken.test(line));
  assert.deepEqual(violations, [], 'new app-layer visual declarations must be implemented by a skin');
});

test('app stylesheet keeps visual declarations inside the UI kit layer', async () => {
  const source = await readFile(path.join(root, 'src/app.css'), 'utf8');
  assert.doesNotMatch(
    source,
    visualDeclaration,
    'src/app.css must remain an entrypoint/layout stylesheet; visual CSS belongs to ui-kit skins',
  );
});

test('agent icons come from plugin path data, without skin-owned brand maps or URL loading', async () => {
  const source = await readFile(path.join(root, 'src/lib/ui-kit/kits/base.css'), 'utf8');
  assert.doesNotMatch(source, /mask-image|assets\/(?:openai|pi)\.svg/);
  for (const skin of ['ak-ui']) {
    const component = await readFile(path.join(root, `src/lib/ui-kit/kits/${skin}/AgentStatusMark.svelte`), 'utf8');
    assert.match(component, /d=\{icon\.path\}/);
    assert.doesNotMatch(component, /@html|<image|<img|href=|src=/);
  }
  for (const skin of ['shadcn', 'material3']) {
    const external = await readFile(path.join(root, `packages/presentation-${skin}/skin.js`), 'utf8');
    assert.match(external, /d:props\.icon\.path/);
    assert.doesNotMatch(external, /agentPaths/);
  }
});

test('the ak-ui skin draws colours from theme tokens, not raw values', async () => {
  const source = await readFile(path.join(root, 'src/lib/ui-kit/kits/ak-ui.css'), 'utf8');
  assert.deepEqual(source.match(/#[0-9a-f]{3,8}\b/gi) ?? [], [], 'raw colours belong in kits/ak-ui/themes.json');
});

test('skin text never drops below the 12px metadata floor', async () => {
  const files = ['src/lib/ui-kit/kits/base.css', 'src/lib/ui-kit/kits/ak-ui.css'];
  for (const kit of ['src/lib/ui-kit/kits/ak-ui', 'src/lib/ui-kit/kits/shared']) {
    for (const name of await readdir(path.join(root, kit))) if (name.endsWith('.svelte')) files.push(path.join(kit, name));
  }
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    const tiny = [...source.matchAll(/\bfont(?:-size)?\s*:\s*(\d+(?:\.\d+)?)px/g)].filter(match => Number(match[1]) < 12).map(match => match[0]);
    assert.deepEqual(tiny, [], `${file} uses text smaller than --aibo-type-meta`);
  }
});


test('ak-ui does not restore a universal transition override', async () => {
  const source = await readFile(path.join(root, 'src/lib/ui-kit/kits/ak-ui.css'), 'utf8');
  assert.doesNotMatch(source, /\]\s+\*\s*\{[^}]*transition/s);
});
