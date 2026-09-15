import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMentionSuggestions } from '../src/lib/app/mention-suggestions.ts';

const sessions = [
  { id: 'codex', agent: 'codex', label: 'Codex session' },
  { id: 'pi', agent: 'pi', label: 'Pi session' },
];
const paths = [
  { path: 'src', isDirectory: true },
  { path: 'README.md', isDirectory: false },
];

test('mention categories separate files, folders and sessions while All preserves every kind', () => {
  assert.deepEqual(filterMentionSuggestions(sessions, paths, 'all').map(item => item.kind), ['session', 'session', 'folder', 'file']);
  assert.deepEqual(filterMentionSuggestions(sessions, paths, 'files').map(item => item.kind), ['file']);
  assert.deepEqual(filterMentionSuggestions(sessions, paths, 'folders').map(item => item.kind), ['folder']);
  assert.deepEqual(filterMentionSuggestions(sessions, paths, 'sessions').map(item => item.kind), ['session', 'session']);
});
