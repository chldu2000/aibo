import test from 'node:test';
import assert from 'node:assert/strict';
import { commandComposerInsertion, visibleSessionCommands, sessionBuiltinCommands } from '../src/lib/app/agent-commands.ts';

test('bound providers get host commands from negotiated capabilities, independent of their identity', () => {
  for (const agent of ['codex', 'pi', 'dev.example.agent']) {
    const session = {agent, pluginInstallationId:'installed', capabilities:['session.tree','compaction.run','goal.manage']};
    const commands = sessionBuiltinCommands(session, ['plan']).map(command=>command.name);
    for (const name of ['settings','new','tree','compact','goal','plan']) assert.ok(commands.includes(name));
    for (const name of ['fork','model','reload']) assert.ok(!commands.includes(name));
    assert.deepEqual(sessionBuiltinCommands({...session,pluginInstallationId:null}), []);
  }
});

test('provider skill syntax is data, including for a third-party provider', () => {
  const skill = {name:'review',source:'skill',category:'skill',insertionText:'$review '};
  assert.equal(commandComposerInsertion(skill), '$review ');
  assert.equal(commandComposerInsertion({...skill,insertionText:undefined}), '/review ');
  assert.equal(commandComposerInsertion({name:'model'}), '/model ');
  const commands=visibleSessionCommands([{name:'skills'}], [skill,{name:'skills'}, {name:'hidden',enabled:false}]);
  assert.deepEqual(commands.map(command=>command.name), ['skills','review']);
});
