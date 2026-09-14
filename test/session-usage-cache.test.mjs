import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheSessionUsage, usageForSession } from '../src/lib/app/session-usage-cache.ts';

test('usage remains attached to its session across A to B to A navigation', () => {
  let cache = {};
  cache = cacheSessionUsage(cache, 'session-a', { total: 1200 });
  assert.deepEqual(usageForSession(cache, 'session-a'), { total: 1200 });
  assert.equal(usageForSession(cache, 'session-b'), null);

  cache = cacheSessionUsage(cache, 'session-b', { total: 80 });
  assert.deepEqual(usageForSession(cache, 'session-a'), { total: 1200 });
  assert.deepEqual(usageForSession(cache, 'session-b'), { total: 80 });
});

test('a provider can clear one session without clearing the others', () => {
  const cache = {
    'session-a': { total: 1200 },
    'session-b': { total: 80 },
  };
  const next = cacheSessionUsage(cache, 'session-a', null);
  assert.equal(usageForSession(next, 'session-a'), null);
  assert.deepEqual(usageForSession(next, 'session-b'), { total: 80 });
});
