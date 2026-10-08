import assert from 'node:assert/strict';
import test from 'node:test';

import { toUsageValues, toPresentationUsage, nextUsageReset } from '../src/lib/app/session-usage.ts';

test('observed quota expires without a new provider event; missing reset remains a last observation', () => {
  const snapshot = { totalTokens: 12, limits: [
    { id: 'five_hour', usedPercent: 24, observedAt: 1000, resetsAt: 2000 },
    { id: 'seven_day', usedPercent: 13, observedAt: 1000 },
  ] };
  assert.equal(toUsageValues(snapshot, 1999).limits[0].usedPercent, 24);
  const expired = toUsageValues(snapshot, 2000);
  assert.equal(expired.limits[0].usedPercent, null);
  assert.equal(expired.limits[1].usedPercent, 13);
  assert.equal(expired.limits[1].resetsAt, null);
  assert.equal(expired.total, 12);
  assert.equal(nextUsageReset(snapshot, 1999), 2000);
  assert.equal(nextUsageReset(snapshot, 2000), null);
  const wire = toPresentationUsage(expired);
  assert.deepEqual(wire.limits.map(l => l.id), ['seven_day']);
  assert.equal(wire.unknownLimits[0].id, 'five_hour');
  assert.ok(!('usedPercent' in wire.unknownLimits[0]));
  assert.equal(snapshot.limits[0].usedPercent, 24, 'projection never mutates evidence');
});

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

test('Codex cumulative thread usage is not treated as the live context size', () => {
  const usage = toUsageValues({
    total: { inputTokens: 903_727, outputTokens: 20_000, totalTokens: 923_727 },
    last: { inputTokens: 78_000, outputTokens: 2_000, totalTokens: 80_000 },
    modelContextWindow: 258_400,
  });

  assert.equal(usage?.total, 923_727);
  assert.equal(usage?.contextUsed, 80_000);
  assert.equal(usage?.contextLimit, 258_400);
  assert.equal(usage?.contextEstimated, false);
});

test('ACP adapter snapshots report the live context, not an input estimate', () => {
  const usage = toUsageValues({ contextTokens: 42_000, contextWindow: 200_000, input: 1_000, output: 50, totalTokens: 1_050 });
  assert.equal(usage?.contextUsed, 42_000);
  assert.equal(usage?.contextLimit, 200_000);
  assert.equal(usage?.contextEstimated, false);
  assert.equal(usage?.total, 1_050);
});
