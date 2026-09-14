import assert from 'node:assert/strict';
import test from 'node:test';

import { toUsageValues } from '../src/lib/app/session-usage.ts';

test('session usage normalizes context and optional plan limits for every presentation', () => {
  assert.deepEqual(toUsageValues({
    total: { inputTokens: 24_000, outputTokens: 1_000, totalTokens: 25_000, modelContextWindow: 100_000 },
    plan: 'plus',
    limits: [{ id: 'codex-primary', label: '5 小时', usedPercent: 35, windowMinutes: 300, resetsAt: 1_900_000_000 }],
    credits: { balance: '12.5', unlimited: false },
  }), {
    input: 24_000,
    output: 1_000,
    total: 25_000,
    contextUsed: 24_000,
    contextLimit: 100_000,
    contextEstimated: true,
    plan: 'plus',
    limits: [{ id: 'codex-primary', label: '5 小时', usedPercent: 35, windowMinutes: 300, resetsAt: 1_900_000_000 }],
    credits: { balance: '12.5', unlimited: false },
  });
});

test('malformed optional account usage cannot hide valid token usage', () => {
  const usage = toUsageValues({ input: 10, total: 12, limits: [{ usedPercent: 'all' }], credits: [] });
  assert.equal(usage?.total, 12);
  assert.deepEqual(usage?.limits, []);
  assert.equal(usage?.credits, null);
});
