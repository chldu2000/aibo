import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceGitController } from '../src/lib/app/workspace-git-controller.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const repository = id => ({ id, name: id, relativePath: id, kind: 'repository', externalRoot: false });
const discovery = (...ids) => ({ repositories: ids.map(repository), limited: false, warnings: [], scanBudget: 2000 });
const changes = (workspaceId, files = []) => ({ workspaceId, head: 'head', branch: 'main', dirty: !!files.length, capturedAt: 'now', captureStatus: 'captured', captureError: null, files });
const diff = path => ({ path, staged: false, available: true, truncated: false, diff: '+new', hunks: [], reason: null });
const commit = hash => ({ hash, shortHash: hash, subject: hash, author: 'a', authoredAt: 'now' });
const file = path => ({ path, previousPath: null, kind: 'modified', staged: false, unstaged: true, untracked: false, conflicted: false });
function fixture(overrides = {}, storage = new Map()) {
  const calls = [], notices = [], errors = [], snapshots = [], reviews = [];
  const defaults = {
    listWorkspaceGitRepositories: async () => discovery('one', 'two'),
    getWorkspaceChanges: async workspace => changes(workspace, [file('same.txt')]),
    getWorkspaceFileDiff: async (_, path) => diff(path),
    listWorkspaceGitBranches: async () => [], listWorkspaceGitHistory: async () => [],
    getWorkspaceGitRemoteStatus: async () => ({ branch: 'main', upstream: null, ahead: 0, behind: 0 }),
    listWorkspaceGitStashes: async () => [],
    listWorkspaceGitCommitFiles: async (_, hash) => ({ commit: hash, files: [], total: 0 }),
    getWorkspaceGitCommitFileDiff: async (_, __, path) => diff(path),
    commitWorkspaceChanges: async () => ({ committed: true, hash: 'new', message: 'ok' }),
    ...Object.fromEntries(['checkoutWorkspaceGitBranch', 'createWorkspaceGitBranch', 'syncWorkspaceGit', 'stashWorkspaceGit', 'applyWorkspaceGitStash', 'applyWorkspaceGitFileAction', 'applyWorkspaceGitAction'].map(key => [key, async () => ({ applied: true, message: 'ok' })])),
    ...overrides,
  };
  const api = Object.fromEntries(Object.entries(defaults).map(([key, fn]) => [key, (...args) => { calls.push([key, ...args]); return fn(...args); }]));
  const controller = createWorkspaceGitController({ api, desktop: () => true, windowId: 'test',
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    changed: value => snapshots.push(value), error: value => errors.push(value), notice: (...value) => notices.push(value),
    reviewContext: () => ({ session: { id: 's', workspaceId: 'a', agent: 'plugin', pluginInstallationId: 'p', archived: false }, running: false, profile: { model: 'model' } }),
    startReview: async review => { reviews.push(review); },
  });
  return { controller, calls, notices, errors, snapshots, reviews, storage };
}
async function select(controller, workspace = 'a', repository = 'one') {
  controller.selectWorkspace(workspace);
  await controller.refreshWorkspaceChanges(workspace);
  controller.selectRepository(repository);
  await tick();
}

test('discovery bounds concurrency, publishes independent failures, and restores scoped preferences', async () => {
  const pending = Array.from({ length: 5 }, deferred);
  let active = 0, maximum = 0;
  const f = fixture({ listWorkspaceGitRepositories: async () => discovery('0', '1', '2', '3', '4'),
    getWorkspaceChanges: async (workspace, id) => { active++; maximum = Math.max(maximum, active); try { return await pending[Number(id)].promise; } finally { active--; } },
  });
  f.controller.selectWorkspace('a');
  const reading = f.controller.refreshWorkspaceChanges('a');
  await tick();
  assert.equal(f.controller.snapshot.repositories.length, 5);
  assert.equal(active, 4);
  pending[0].resolve(changes('a')); pending[1].reject(new Error('unreadable')); pending[2].resolve(changes('a')); pending[3].resolve(changes('a'));
  await tick();
  assert.match(f.controller.snapshot.repositories[1].error, /unreadable/);
  pending[4].resolve(changes('a')); await reading;
  assert.equal(maximum, 4); assert.equal(f.controller.snapshot.loading, false);
  f.controller.selectRepository('2'); f.controller.toggleRepository('3'); f.controller.changeDraft({ commitMessage: 'keep' });
  const reloaded = fixture({ listWorkspaceGitRepositories: async () => discovery('0', '1', '2', '3', '4') }, f.storage);
  await select(reloaded.controller, 'a', '2');
  assert.equal(reloaded.controller.snapshot.draft.commitMessage, 'keep');
  assert.deepEqual(reloaded.controller.snapshot.collapsedRepositories, ['3']);
  await select(reloaded.controller, 'b', '2');
  assert.equal(reloaded.controller.snapshot.draft.commitMessage, '');
});

test('workspace roundtrip revokes old discovery and does not let old background completion unlock a new read', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const f = fixture({ listWorkspaceGitRepositories: () => (++count === 1 ? first.promise : second.promise) });
  f.controller.selectWorkspace('a'); const old = f.controller.refreshWorkspaceChanges('a', true);
  f.controller.selectWorkspace('b'); f.controller.selectWorkspace('a');
  const fresh = f.controller.refreshWorkspaceChanges('a', true);
  first.resolve(discovery('stale')); await old;
  await f.controller.refreshWorkspaceChanges('a', true);
  assert.equal(count, 2, 'old finally must not clear the current background guard');
  second.resolve(discovery('new')); await fresh;
  assert.deepEqual(f.controller.snapshot.repositories.map(repo => repo.id), ['new']);
});

test('late metadata, commit files and diff cannot restore a previous repository or closed preview', async () => {
  const history = deferred(), files = deferred(), preview = deferred();
  const f = fixture({
    listWorkspaceGitHistory: async (_, __, repo) => repo === 'one' ? history.promise : [commit('two')],
    listWorkspaceGitCommitFiles: async () => files.promise,
    getWorkspaceFileDiff: async () => preview.promise,
  });
  await select(f.controller);
  const loadingFiles = f.controller.loadWorkspaceCommitFiles('a', 'old');
  const loadingDiff = f.controller.openWorkspaceFileDiff('a', 'same.txt', false, 'one');
  f.controller.selectRepository('two'); await tick();
  history.resolve([commit('stale')]); files.resolve({ commit: 'old', files: [file('old')], total: 1 }); preview.resolve(diff('old'));
  await Promise.all([loadingFiles, loadingDiff]); await tick();
  assert.deepEqual(f.controller.snapshot.history.map(item => item.hash), ['two']);
  assert.equal(f.controller.snapshot.commitFiles, null); assert.equal(f.controller.snapshot.fileDiff, null);
  const later = deferred();
  const g = fixture({ getWorkspaceFileDiff: () => later.promise }); await select(g.controller);
  const request = g.controller.openWorkspaceFileDiff('a', 'same.txt', false);
  g.controller.closeWorkspaceFileDiff(); later.reject(new Error('late failure')); await request;
  assert.equal(g.controller.snapshot.fileDiffError, null); assert.equal(g.controller.snapshot.fileDiffLoading, false);
});

test('history paging retains appended commits through background refresh, deduplicates and retries failures', async () => {
  const all = Array.from({ length: 36 }, (_, i) => commit(String(i)));
  let fail = false;
  const f = fixture({ listWorkspaceGitHistory: async (_, limit, __, offset = 0) => {
    if (fail && offset) throw new Error('page failed');
    return all.slice(offset, offset + limit);
  } });
  await select(f.controller); assert.equal(f.controller.snapshot.history.length, 16);
  fail = true; await f.controller.loadMoreWorkspaceGitHistory('a');
  assert.match(f.controller.snapshot.historyLoadMoreError, /page failed/);
  fail = false; await f.controller.loadMoreWorkspaceGitHistory('a');
  assert.equal(f.controller.snapshot.history.length, 32);
  await f.controller.refreshWorkspaceGitMetadata('a', true);
  assert.equal(f.controller.snapshot.history.length, 32);
  await f.controller.loadMoreWorkspaceGitHistory('a');
  assert.equal(f.controller.snapshot.history.length, 36); assert.equal(f.controller.snapshot.historyHasMore, false);
  assert.equal(new Set(f.controller.snapshot.history.map(item => item.hash)).size, 36);
});

test('writes retain their original target and settle after navigation without clearing another draft or preview', async () => {
  const pending = deferred(); const f = fixture({ commitWorkspaceChanges: () => pending.promise });
  await select(f.controller); f.controller.changeDraft({ commitMessage: 'submitted' });
  const writing = f.controller.commitWorkspaceGitChanges('a', 'submitted');
  assert.equal(f.controller.snapshot.operationBusy, true);
  assert.equal(await f.controller.commitWorkspaceGitChanges('a', 'duplicate'), false);
  f.controller.selectRepository('two'); assert.equal(f.controller.snapshot.repositoryId, 'one', 'cannot retarget while writing');
  f.controller.selectWorkspace('b'); await f.controller.refreshWorkspaceChanges('b');
  f.controller.changeDraft({ commitMessage: 'new workspace draft' });
  await f.controller.openWorkspaceFileDiff('b', 'new.txt', false, 'two');
  const before = f.calls.length;
  pending.resolve({ committed: true, hash: 'new-hash', message: 'ok' });
  assert.equal(await writing, true);
  assert.equal(f.calls.length, before, 'old write must not start reads against the new workspace');
  assert.equal(f.controller.snapshot.fileDiffPath, 'new.txt');
  assert.equal(f.controller.snapshot.draft.commitMessage, 'new workspace draft');
  assert.equal(f.controller.snapshot.operationBusy, false); assert.equal(f.notices.at(-1)[1], 'success');
  assert.deepEqual(f.calls.find(call => call[0] === 'commitWorkspaceChanges'), ['commitWorkspaceChanges', 'a', 'submitted', undefined, 'one']);
  await select(f.controller); assert.equal(f.controller.snapshot.draft.commitMessage, '');
});

test('failed writes and editing during a write retain the draft; same-named files bind explicit repositories', async () => {
  const pending = deferred(); let attempt = 0;
  const f = fixture({ commitWorkspaceChanges: async () => ++attempt === 1 ? { committed: false, message: 'rejected' } : pending.promise });
  await select(f.controller); f.controller.changeDraft({ commitMessage: 'first' });
  assert.equal(await f.controller.commitWorkspaceGitChanges('a', 'first'), false);
  assert.equal(f.controller.snapshot.draft.commitMessage, 'first'); assert.equal(f.errors.at(-1), 'rejected');
  const writing = f.controller.commitWorkspaceGitChanges('a', 'first');
  f.controller.changeDraft({ commitMessage: 'new input' }); pending.resolve({ committed: true, hash: 'h', message: 'ok' }); await writing;
  assert.equal(f.controller.snapshot.draft.commitMessage, 'new input');
  f.controller.selectRepository(null);
  await f.controller.applyWorkspaceGitAction('a', 'same.txt', 'stage', 'two');
  assert.deepEqual(f.calls.find(call => call[0] === 'applyWorkspaceGitFileAction'), ['applyWorkspaceGitFileAction', 'a', 'same.txt', 'stage', undefined, 'two']);
});

test('commit file paging and repository section selection share host-owned draft and preview state', async () => {
  const f = fixture({ listWorkspaceGitCommitFiles: async (_, hash, offset) => ({ commit: hash, files: [file(String(offset))], total: 2 }) });
  await select(f.controller); f.controller.selectRepository(null); f.controller.selectSection('history');
  assert.equal(f.controller.snapshot.repositoryPickerOpen, true);
  f.controller.selectRepository('two'); assert.equal(f.controller.snapshot.draft.gitSection, 'history');
  await f.controller.loadWorkspaceCommitFiles('a', 'hash'); await f.controller.loadWorkspaceCommitFiles('a', 'hash', true);
  assert.deepEqual(f.controller.snapshot.commitFiles.files.map(item => item.path), ['0', '1']);
  await f.controller.openWorkspaceCommitFileDiff('a', 'hash', 'old.txt');
  assert.match(f.controller.snapshot.fileDiffContextLabel, /two.*提交 hash.*old.txt/);
});

test('review captures the original repository and read-only profile even while the user navigates away', async () => {
  const pending = deferred(); const f = fixture({ getWorkspaceFileDiff: () => pending.promise });
  await select(f.controller); const review = f.controller.requestWorkspaceAgentReview('a');
  f.controller.selectWorkspace('b'); pending.resolve(diff('same.txt')); await review;
  assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].workspaceId, 'a');
  assert.equal(f.reviews[0].profile.filesystemPolicy, 'read-only'); assert.equal(f.reviews[0].profile.model, 'model');
  assert.match(f.reviews[0].prompt, /same.txt/); assert.equal(f.controller.snapshot.workspaceId, 'b');
  assert.equal(f.controller.snapshot.reviewBusy, false);
});

test('visible polling reads changes promptly, throttles metadata, and refreshes metadata on focus', async () => {
  const f = fixture(); await select(f.controller); f.calls.length = 0;
  f.controller.refreshVisible(false, 10_000); await tick();
  f.controller.refreshVisible(false, 11_250); await tick();
  f.controller.refreshVisible(false, 12_500); await tick();
  const count = name => f.calls.filter(call => call[0] === name).length;
  assert.equal(count('listWorkspaceGitRepositories'), 3);
  assert.equal(count('listWorkspaceGitHistory'), 1, 'metadata does not run on every status poll');
  f.controller.refreshVisible(false, 15_000); await tick();
  assert.equal(count('listWorkspaceGitHistory'), 2);
  f.controller.refreshVisible(true, 15_100); await tick();
  assert.equal(count('listWorkspaceGitHistory'), 3, 'focus forces metadata refresh');
});

test('branch, sync, stash and grouped staging all preserve the selected repository and host result', async () => {
  const f = fixture(); await select(f.controller, 'a', 'two');
  f.controller.changeDraft({ branchDraft: 'topic' });
  await f.controller.createWorkspaceBranch('a', 'topic');
  assert.equal(f.controller.snapshot.draft.branchDraft, '');
  await f.controller.checkoutWorkspaceBranch('a', 'main');
  for (const action of ['fetch', 'pull', 'push']) await f.controller.syncWorkspaceBranch('a', action);
  await f.controller.saveWorkspaceStash('a');
  await f.controller.applyWorkspaceStash('a', 'stash@{0}');
  await f.controller.applyWorkspaceGitWorkspaceAction('a', 'stage_untracked');
  const writes = f.calls.filter(call => ['createWorkspaceGitBranch', 'checkoutWorkspaceGitBranch', 'syncWorkspaceGit', 'stashWorkspaceGit', 'applyWorkspaceGitStash', 'applyWorkspaceGitAction'].includes(call[0]));
  assert.equal(writes.length, 8);
  assert.ok(writes.every(call => call[1] === 'a' && call.at(-1) === 'two'));
  assert.equal(f.notices.length, 8);
  assert.equal(f.controller.snapshot.operationBusy, false);
});
