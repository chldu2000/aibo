import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {sessionControlOptions} from '../src/lib/app/session-access-profile.ts';

const source = readFileSync(new URL('../src/lib/components/app/Composer.svelte', import.meta.url), 'utf8');
const expression = source.match(/const accessOptions = \$derived\(([^\n]+)\);/)?.[1];
assert.ok(expression, 'exercise the actual Composer permission-menu input');
const options = new Function('selectedSession', 'selectedSessionId', 'executionProfile', 'sessionControlOptions', `return ${expression};`);
const controls = [{id:'team-policy',kind:'permission',label:'Team policy',description:'Plugin label',profile:{filesystemPolicy:'read-only'}}];
const resolve = (selected, id, profile) => options(selected,id,profile,sessionControlOptions);

test('Composer reads plugin menu descriptors with boolean selectedSession', () => {
  assert.deepEqual(resolve(true,'session-a',{sessionId:'session-a',sessionControls:controls}),controls);
});

test('Composer excludes stale profiles, undeclared options and unselected sessions', () => {
  const profile = {sessionId:'session-a',sessionControls:controls};
  assert.deepEqual(resolve(true,'session-b',profile),[]);
  assert.deepEqual(resolve(false,null,profile),[]);
  assert.deepEqual(resolve(true,'session-a',null),[]);
  assert.deepEqual(resolve(true,'session-a',{sessionId:'session-a'}),[]);
});
