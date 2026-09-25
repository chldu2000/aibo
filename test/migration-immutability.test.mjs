import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkMigrations } from '../scripts/check-migrations.mjs';

const original = 'src-tauri/migrations/0002_original.sql';
const history = 'src-tauri/migration-history/0002_initial.sql';
const fixture = 'fixtures/migrations/0002_original.sql';

function repository(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibo-migration-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file, content = 'SELECT 1;\n') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Migration test', '-c', 'user.email=migration-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  for (const file of [original, history, fixture]) write(file);
  const baseRef = commit();
  return { root, git, write, commit, baseRef, check: () => checkMigrations({ root, baseRef }) };
}

test('unchanged history and newly appended migrations pass, including untracked additions', t => {
  const repo = repository(t);
  repo.check();
  repo.write('src-tauri/migrations/0003_next.sql');
  repo.write('src-tauri/migration-history/0002_another_known_version.sql');
  repo.check();
  repo.commit();
  repo.check();
});

for (const file of [original, history, fixture]) {
  for (const change of ['edit', 'delete', 'rename', 'whitespace', 'line endings']) {
    test(`rejects ${change} of frozen ${file}`, t => {
      const repo = repository(t);
      const absolute = path.join(repo.root, file);
      if (change === 'delete') rmSync(absolute);
      else if (change === 'rename') renameSync(absolute, absolute.replace('.sql', '_renamed.sql'));
      else repo.write(file, change === 'whitespace' ? 'SELECT 1;\n\n' : change === 'line endings' ? 'SELECT 1;\r\n' : 'SELECT 2;\n');
      assert.throws(repo.check, /frozen migration changed, deleted, or renamed/);
    });
  }
}

test('staged edits cannot be hidden by restoring only the working copy', t => {
  const repo = repository(t);
  repo.write(original, 'SELECT 2;\n');
  repo.git('add', original);
  repo.write(original);
  assert.throws(repo.check, /staged files.*frozen migration/);
});

test('CI base catches changes already committed on the branch', t => {
  const repo = repository(t);
  repo.write(original, 'SELECT 2;\n');
  repo.commit();
  assert.throws(repo.check, /frozen migration/);
});

test('HEAD freezes migrations added since the CI base', t => {
  const repo = repository(t);
  const added = 'src-tauri/migrations/0003_next.sql';
  repo.write(added);
  repo.commit();
  repo.write(added, 'SELECT 2;\n');
  assert.throws(repo.check, /against HEAD.*frozen migration/);
});

for (const [file, expected] of [
  ['0001_inserted.sql', /must have a version greater than 2/],
  ['0002_duplicate.sql', /duplicate migration version 2/],
  ['00002_duplicate.sql', /duplicate migration version 2/],
  ['0000_invalid.sql', /Invalid migration filename/],
  ['9223372036854775808_overflow.sql', /Invalid migration filename/],
  ['next.sql', /Invalid migration filename/],
]) {
  test(`rejects invalid migration addition ${file}`, t => {
    const repo = repository(t);
    repo.write(`src-tauri/migrations/${file}`);
    assert.throws(repo.check, expected);
  });
}

test('rejects duplicate versions among new migrations', t => {
  const repo = repository(t);
  repo.write('src-tauri/migrations/0003_first.sql');
  repo.write('src-tauri/migrations/0003_second.sql');
  assert.throws(repo.check, /duplicate migration version 3/);
});

test('rejects symbolic links even when their target has identical SQL', t => {
  const repo = repository(t);
  const absolute = path.join(repo.root, original);
  const bytes = readFileSync(absolute);
  repo.write('outside.sql', bytes);
  rmSync(absolute);
  symlinkSync('../../outside.sql', absolute);
  assert.throws(repo.check, /must be a regular file/);
});

test('missing and all-zero baselines fail instead of silently skipping the check', t => {
  const repo = repository(t);
  assert.throws(() => checkMigrations({ root: repo.root, baseRef: 'missing-ref' }), /Cannot resolve migration baseline/);
  assert.throws(() => checkMigrations({ root: repo.root, baseRef: '0'.repeat(40) }), /all-zero Git ref/);
});
