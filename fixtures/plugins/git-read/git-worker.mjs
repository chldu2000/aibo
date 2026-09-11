import { createInterface } from 'node:readline';
import { readFileSync, realpathSync, existsSync, lstatSync, openSync, readSync, closeSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
const MAX = 32_000;
const fail = code => { throw Object.assign(new Error(code), { code }); };
function git(root, args, maxBuffer = 2_000_000) {
  try { return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8', timeout: 4000, maxBuffer, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' } }); }
  catch (error) { if (args[0] === 'diff' && error.code === 'ENOBUFS' && error.stdout) return String(error.stdout); fail('provider_unavailable'); }
}
function checked(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) fail('permission_denied');
  const target = path.resolve(root, relative);
  let existing = target;
  while (!existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) fail('permission_denied'); existing = parent; }
  const actual = realpathSync(existing), base = realpathSync(root);
  if (actual !== base && !actual.startsWith(base + path.sep)) fail('permission_denied');
  return target;
}
function changes(root) {
  // -z gives literal paths, including tabs/newlines, without shell or quote parsing.
  const records = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const items = []; let truncated = false, bytes = 0;
  for (let index = 0; index < records.length && records[index]; index++) {
    const record = records[index], x = record[0], y = record[1], name = record.slice(3);
    const previousPath = x === 'R' || x === 'C' || y === 'R' || y === 'C' ? records[++index] : null;
    if (Buffer.byteLength(name) > 4000) fail('invalid_output');
    const conflict = x === 'U' || y === 'U' || ['AA', 'DD'].includes(x + y);
    for (const staged of [true, false]) {
      if (staged ? x === ' ' || x === '?' : y === ' ' && !conflict) continue;
      const code = staged ? x : y;
      const status = conflict ? 'conflicted' : x === '?' ? 'untracked' : ({ A: 'added', D: 'deleted', R: 'renamed', C: 'added' }[code] ?? 'modified');
      items.push({ id: `${staged ? 'index' : 'worktree'}:${name}`, path: name, previousPath, status, staged });
      bytes += Buffer.byteLength(JSON.stringify(items.at(-1)));
      if (items.length >= 1000 || bytes >= 90_000) { truncated = true; break; }
    }
    if (truncated) break;
  }
  items.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : Number(b.staged) - Number(a.staged));
  return { items, truncated };
}
function diff(root, name, staged) {
  const target = checked(root, name);
  let content;
  const tracked = git(root, ['ls-files', '-z', '--', name]);
  if (!staged && !tracked && existsSync(target)) {
    if (!lstatSync(target).isFile()) fail('permission_denied');
    const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const buffer = Buffer.alloc(MAX * 4 + 4); const count = readSync(fd, buffer, 0, buffer.length, 0); content = buffer.subarray(0, count).toString('utf8'); } finally { closeSync(fd); }
  } else content = git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', ...(staged ? ['--cached'] : []), '--', name]);
  const clipped = content.slice(0, MAX).replace(/[\uD800-\uDBFF]$/, '');
  return { content: clipped, truncated: content.length > MAX };
}
function view(root, input) {
  const { items, truncated } = changes(root);
  const offset = Math.min(input.offset ?? 0, Math.max(0, Math.ceil(items.length / 50) * 50 - 50));
  const state = { status: items.length ? 'ready' : 'empty', message: items.length ? '' : '没有工作区变更' };
  if (input.actionId === 'open-diff') {
    const item = items.find(item => item.id === input.itemId);
    if (!item) fail('invalid_input');
    return { state, view: { kind: 'detail', itemId: item.id, properties: [{ label: '文件', value: item.path }, { label: '范围', value: item.staged ? '暂存区' : '工作区' }], ...diff(root, item.path, item.staged) }, actions: [{ id: 'back', label: '返回变更列表', intent: 'navigate', enabled: true }, { id: 'refresh', label: '刷新', intent: 'refresh', enabled: true }] };
  }
  return { state, view: { kind: 'collection', properties: [{ key: 'path', label: '文件', type: 'text', values: [] }, { key: 'status', label: '状态', type: 'text', values: [] }, { key: 'scope', label: '范围', type: 'text', values: [] }], items: items.slice(offset, offset + 50).map(item => ({ id: item.id, values: { path: item.path, status: item.status, scope: item.staged ? '暂存区' : '工作区' } })), selection: null, page: { offset, size: 50, total: items.length, truncated } }, actions: [{ id: 'refresh', label: '刷新', intent: 'refresh', enabled: true }, { id: 'open-diff', label: '查看差异', intent: 'inspect', enabled: items.length > 0 }, { id: 'previous', label: '上一页', intent: 'navigate', enabled: offset > 0 }, { id: 'next', label: '下一页', intent: 'navigate', enabled: offset + 50 < items.length }] };
}
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params: p } = JSON.parse(line);
  try {
    if (method === 'capability.initialize') {
      const contribution = manifest.contributions.find(item => item.id === p.contributionId);
      send({ id, result: { protocol: '2.0', pluginId: manifest.pluginId, pluginVersion: manifest.version, generationId: p.generationId, operations: contribution.operations.map(op => ({ capability: op.capability.id, version: op.capability.version, operationId: op.id })) } });
    } else if (method === 'capability.invoke') {
      const root = p.context.workspacePath;
      if (!root || !p.context.permissions.includes('workspace.read')) fail('permission_denied');
      if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).replace(/\r?\n$/, '')) !== realpathSync(root)) fail('permission_denied');
      const output = p.operationId === 'dev.aibo.git.changes' ? changes(root) : p.operationId === 'dev.aibo.git.diff' ? diff(root, p.input.path, p.input.staged) : view(root, p.input);
      send({ id, result: { invocationId: p.invocationId, generationId: p.generationId, output } });
    }
  } catch (error) { send({ id, error: { code: -32000, message: 'Git read failed', data: { kind: ['permission_denied', 'invalid_input', 'invalid_output'].includes(error.code) ? error.code : 'provider_unavailable' } } }); }
});
