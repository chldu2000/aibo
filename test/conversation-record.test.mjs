import assert from 'node:assert/strict';
import test from 'node:test';
import { toolGroupDuration, toolContentPreview } from '../src/lib/app/conversation-record.ts';

test('group duration totals only complete observed intervals, including failures', () => {
  const record = {status:'completed',createdAt:'2026-09-24T12:00:00Z',updatedAt:'2026-09-24T12:00:00.100Z'};
  assert.equal(toolGroupDuration([record,{...record,status:'failed',updatedAt:'2026-09-24T12:00:15.700Z'}]),'15.8s');
  for (const incomplete of [{updatedAt:undefined}, {status:'streaming'}, {status:'queued'}, {createdAt:'invalid'}, {updatedAt:record.createdAt}, {updatedAt:'2026-09-23'}]) {
    assert.equal(toolGroupDuration([record,{...record,...incomplete}]),null);
  }
  assert.equal(toolGroupDuration([]),null);
});

test('tool preview preserves supplied content without guessing a target or parsing provider payloads', () => {
  assert.equal(toolContentPreview('\n src/example.ts\ncontents'), 'src/example.ts');
  assert.equal(toolContentPreview('{"command":"echo hi"}'), '{"command":"echo hi"}');
  assert.equal(toolContentPreview('  \n'), '');
});
