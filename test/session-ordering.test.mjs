import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertSession, replaceSession, reconcileSessionRefresh } from '../src/lib/app/session-transitions.ts';

const recent = { id: 'recent', workspaceId: 'w', updatedAt: '2026-09-25T10:00:00Z' };
const old = { id: 'old', workspaceId: 'w', updatedAt: '2026-09-20T10:00:00Z' };

test('updating an old session without content activity does not promote it', () => {
  const updated = { ...old, state: 'idle' };
  assert.deepEqual(upsertSession({ w: [recent, old] }, updated).w, [recent, updated]);
  const active = { ...old, updatedAt: '2026-09-26T10:00:00Z' };
  assert.deepEqual(replaceSession({ w: [recent, old] }, active).w, [active, recent]);
});

test('refresh preserves local state but sorts by the latest persisted content activity', () => {
  const updated = { ...old, state: 'idle' };
  assert.deepEqual(reconcileSessionRefresh([recent, old], [recent, updated], [recent, old]), [recent, updated]);
  const content = { ...old, updatedAt: '2026-09-26T10:00:00Z' };
  assert.deepEqual(reconcileSessionRefresh([recent, old], [recent, updated], [content, recent]), [
    { ...updated, updatedAt: content.updatedAt }, recent,
  ]);
});

test('equal activity timestamps have a stable ID order across update and refresh', () => {
  const a = { ...recent, id: 'a' }, b = { ...recent, id: 'b' };
  assert.deepEqual(upsertSession({ w: [b, a] }, a).w, [b, a]);
  assert.deepEqual(reconcileSessionRefresh([], [], [a, b]), [b, a]);
});
