import assert from 'node:assert/strict';
import test from 'node:test';
import { executionTiming } from '../src/lib/app/execution-record.ts';

test('execution timing formats observed completed and failed intervals', () => {
  for (const status of ['completed', 'failed', 'interrupted']) {
    const value = executionTiming({ status, createdAt:'2026-09-24T12:00:00Z', updatedAt:'2026-09-24T12:00:12.400Z' });
    assert.equal(value.durationLabel, '12.4s');
    assert.equal(value.dateTime, '2026-09-24T12:00:00Z');
    assert.match(value.timeLabel, /^\d{2}:\d{2}$/);
  }
  assert.equal(executionTiming({status:'completed',createdAt:'2026-09-24T12:00:00Z',updatedAt:'2026-09-24T12:00:00.200Z'}).durationLabel,'200ms');
});

test('missing, snapshot-only, invalid, reversed and unfinished times do not fabricate durations', () => {
  for (const value of [
    {status:'completed'},
    {status:'completed',createdAt:'invalid',updatedAt:'invalid'},
    {status:'completed',createdAt:'2026-09-24',updatedAt:'2026-09-24'},
    {status:'failed',createdAt:'2026-09-25',updatedAt:'2026-09-24'},
    {status:'streaming',createdAt:'2026-09-24',updatedAt:'2026-09-25'},
    {status:'queued',createdAt:'2026-09-24',updatedAt:'2026-09-25'},
  ]) assert.equal(executionTiming(value).durationLabel, '—');
  assert.equal(executionTiming({status:'completed'}).timeLabel, '—');
});
