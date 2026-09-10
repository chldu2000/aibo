import assert from 'node:assert/strict';
import test from 'node:test';
import { eventTimelineItemId } from '../src/lib/app/agent-event-handler.ts';

test('plugin item IDs are stable within a turn and unique across turns', () => {
  assert.equal(eventTimelineItemId({ turnId: 'turn-a' }, 'assistant-1'), 'turn-a:assistant-1');
  assert.equal(eventTimelineItemId({ turnId: 'turn-a' }, 'assistant-1'), 'turn-a:assistant-1');
  assert.equal(eventTimelineItemId({ turnId: 'turn-b' }, 'assistant-1'), 'turn-b:assistant-1');
  assert.notEqual(eventTimelineItemId({ turnId: 'turn-a' }, 'tool-1'), eventTimelineItemId({ turnId: 'turn-b' }, 'tool-1'));
});
