import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTimelineItems } from '../src/lib/components/app/timeline-utils.ts';

test('Pi reasoning remains an individually foldable entry between system and tool groups', () => {
  const entries = [
    { id: 'model', role: 'system', entryType: 'model_change', toolName: null },
    { id: 'reasoning', role: 'system', entryType: 'reasoning', toolName: 'reasoning' },
    { id: 'call', role: 'tool', entryType: 'tool_call', toolName: 'read' },
    { id: 'result', role: 'tool', entryType: 'message', toolName: 'read' },
    { id: 'text', role: 'assistant', entryType: 'message', toolName: null, content: '我先查看文件。' },
  ];
  const grouped = groupTimelineItems(entries, true);
  assert.deepEqual(grouped.map((item) => item.kind), ['entry', 'entry', 'tool-group', 'entry']);
  assert.equal(grouped[1].item.id, 'reasoning');
  assert.deepEqual(grouped[2].items.map((item) => item.id), ['call', 'result']);
  assert.equal(grouped[3].item.role, 'assistant');
});
