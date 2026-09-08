import test from 'node:test';
import assert from 'node:assert/strict';
import { compactActiveBranch, compactSafeTree } from '../src-tauri/pi-session-serialization.mjs';

function manager(entries, leafId) {
  return {
    getEntries: () => entries,
    getLeafId: () => leafId,
    getLabel: (id) => id === 'assistant-thinking' ? '思考节点' : undefined,
  };
}

test('Pi serialization labels non-text assistant entries without exposing thinking content', () => {
  const entries = [
    {
      id: 'user',
      parentId: null,
      type: 'message',
      timestamp: '2026-09-08T00:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      id: 'assistant-thinking',
      parentId: 'user',
      type: 'message',
      timestamp: '2026-09-08T00:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }] },
    },
    {
      id: 'assistant-tool',
      parentId: 'assistant-thinking',
      type: 'message',
      timestamp: '2026-09-08T00:00:02.000Z',
      message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash' }] },
    },
  ];

  const branch = compactActiveBranch(manager(entries, 'assistant-tool'));
  assert.deepEqual(branch.map((entry) => entry.summary), ['hello', '', '']);
  assert.equal(branch[1].summary.includes('private reasoning'), false);

  const markupEntries = [{
    id: 'markup',
    parentId: null,
    type: 'message',
    timestamp: '2026-09-08T00:00:03.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: '<think>private</think>visible' }] },
  }];
  assert.equal(compactActiveBranch(manager(markupEntries, 'markup'))[0].summary, 'visible');

  const tree = compactSafeTree(manager(entries, 'assistant-tool'));
  assert.equal(tree[0].children[0].summary, 'Agent 思考内容（正文未显示）');
  assert.equal(tree[0].children[0].label, '思考节点');
});

test('Pi serialization breaks malformed parent cycles for branch and tree reads', () => {
  const entries = [
    { id: 'a', parentId: 'b', type: 'message', timestamp: '2026-09-08T00:00:00.000Z', message: { role: 'user', content: [] } },
    { id: 'b', parentId: 'a', type: 'message', timestamp: '2026-09-08T00:00:01.000Z', message: { role: 'assistant', content: [] } },
    { id: 'c', parentId: 'b', type: 'message', timestamp: '2026-09-08T00:00:02.000Z', message: { role: 'user', content: [] } },
  ];

  const session = manager(entries, 'c');
  const branch = compactActiveBranch(session);
  assert.deepEqual(branch.map((entry) => entry.id), ['a', 'b', 'c']);

  const tree = compactSafeTree(session);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'a');
  assert.equal(tree[0].children[0].id, 'b');
  assert.equal(tree[0].children[0].children[0].id, 'c');
});
