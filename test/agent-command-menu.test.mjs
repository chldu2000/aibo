import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandComposerInsertion,
  visibleSessionCommands,
} from '../src/lib/app/agent-commands.ts';

test('Codex skills returned by the agent appear in the slash menu and insert explicit skill syntax', () => {
  const builtin = [{ name: 'skills', description: '刷新 Skills', source: 'builtin', agent: 'codex' }];
  const personalSkill = { name: 'code-review', description: 'Review changes', source: 'skill', category: 'skill' };

  const commands = visibleSessionCommands('codex', builtin, [personalSkill]);

  assert.deepEqual(commands.map((command) => command.name), ['skills', 'code-review']);
  assert.equal(commandComposerInsertion('codex', personalSkill), '$code-review ');
});

test('ordinary slash commands keep slash syntax', () => {
  const command = { name: 'model', description: '切换模型', source: 'builtin', agent: 'codex' };
  assert.equal(commandComposerInsertion('codex', command), '/model ');
});
