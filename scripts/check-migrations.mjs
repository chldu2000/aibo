import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = 'src-tauri/migrations';
const protectedDirectories = [migrations, 'src-tauri/migration-history', 'fixtures/migrations'];

function version(file) {
  const match = /^src-tauri\/migrations\/(\d{4,})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match || BigInt(match[1]) < 1n || BigInt(match[1]) > 9223372036854775807n) {
    throw new Error(`Invalid migration filename: ${file}; use NNNN_description.sql with a positive SQLx version.`);
  }
  return BigInt(match[1]);
}

function validate(snapshot, label) {
  const versions = new Map();
  for (const [file, entry] of snapshot) {
    if (!['100644', '100755'].includes(entry.mode)) {
      throw new Error(`${label}: ${file} must be a regular file, not a symlink or submodule.`);
    }
    if (!file.startsWith(`${migrations}/`)) continue;
    const number = version(file);
    if (versions.has(number)) {
      throw new Error(`${label}: duplicate migration version ${number}: ${versions.get(number)}, ${file}`);
    }
    versions.set(number, file);
  }
  return [...versions.keys()].reduce((maximum, number) => number > maximum ? number : maximum, 0n);
}

function compare(baseline, candidate, label) {
  const maximum = validate(baseline, 'baseline');
  validate(candidate, label);
  for (const [file, entry] of baseline) {
    const current = candidate.get(file);
    if (!current || current.oid !== entry.oid) {
      throw new Error(`${label}: frozen migration changed, deleted, or renamed: ${file}. Restore its exact bytes and append a new migration.`);
    }
  }
  for (const file of candidate.keys()) {
    if (!baseline.has(file) && file.startsWith(`${migrations}/`) && version(file) <= maximum) {
      throw new Error(`${label}: new migration ${file} must have a version greater than ${maximum}.`);
    }
  }
}

export function checkMigrations({ root = repository, baseRef = process.env.AIBO_BASE_REF } = {}) {
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
  // Always check HEAD as well: migrations committed on a feature branch are frozen too.
  const refs = [...new Set(['HEAD', ...(baseRef ? [baseRef] : [])])];
  if (baseRef && /^0+$/.test(baseRef)) {
    throw new Error('AIBO_BASE_REF is an all-zero Git ref. Supply the target/default branch ref for an initial push.');
  }
  const baselines = refs.map(ref => {
    let commit;
    try {
      commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
    } catch {
      throw new Error(`Cannot resolve migration baseline ${ref}. Fetch its history; the check cannot run without a baseline.`);
    }
    const entries = git('ls-tree', '-rz', '--full-tree', commit, '--', ...protectedDirectories);
    const snapshot = new Map(entries.split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t');
      const [mode, , oid] = entry.slice(0, tab).split(' ');
      return [entry.slice(tab + 1), { mode, oid }];
    }));
    return { ref, snapshot };
  });

  const index = new Map(git('ls-files', '--stage', '-z', '--', ...protectedDirectories)
    .split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t');
      const [mode, oid, stage] = entry.slice(0, tab).split(' ');
      if (stage !== '0') throw new Error(`Resolve migration merge conflict: ${entry.slice(tab + 1)}`);
      return [entry.slice(tab + 1), { mode, oid }];
    }));
  const algorithm = git('rev-parse', '--show-object-format');
  const working = new Map();
  for (const directory of protectedDirectories) {
    const absolute = path.join(root, directory);
    let stat;
    try { stat = lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${directory} must be a regular directory.`);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (!entry.isFile()) throw new Error(`${file} must be a regular file; nested directories and symlinks are not supported.`);
      const bytes = readFileSync(path.join(root, file));
      // Hash raw Git blob bytes, without text/line-ending normalization.
      const oid = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      working.set(file, { mode: '100644', oid });
    }
  }
  for (const { ref, snapshot } of baselines) {
    compare(snapshot, index, `staged files against ${ref}`);
    compare(snapshot, working, `working files against ${ref}`);
  }
  return { files: working.size, baselines: refs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkMigrations();
    console.log(`Migration immutability passed: ${result.files} files checked against ${result.baselines.join(', ')}.`);
  } catch (error) {
    console.error(`Migration immutability failed: ${error.message}`);
    process.exitCode = 1;
  }
}
