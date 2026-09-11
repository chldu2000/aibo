import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvePresentationAdapter } from '../src/lib/workbench/presentation-adapters.ts';
const snapshot = JSON.parse(await readFile('fixtures/semantic-git/detail.json', 'utf8'));
const descriptor = { id: 'dev.example.renderer', version: '1.0.0', semanticVersion: '1.0.0', core: ['collection','detail','settings','inspector'], optional: [{ id:'dev.example.renderer.detail',version:'1.0.0',semantic:'detail' }] };
const preference = { id:'dev.example.renderer.detail',version:'1.0.0' };
const core = { mount() { throw Error('not mounting'); } }, specialized = { mount() { throw Error('not mounting'); } };
test('trusted specialized adapter selection keeps the complete validated snapshot', () => {
  const result = resolvePresentationAdapter(descriptor, snapshot, preference, core, [{...preference, adapter:specialized}]);
  assert.equal(result.adapter, specialized); assert.equal(result.choice.kind, 'specialized');
  assert.deepEqual(result.choice.snapshot, snapshot); assert.notEqual(result.choice.snapshot, snapshot);
  result.choice.snapshot.actions[0].enabled = false;
  assert.equal(snapshot.actions[0].enabled, true);
});
test('missing implementation and incompatible optional version fall back without dropping data or actions', () => {
  const missing = resolvePresentationAdapter(descriptor, snapshot, preference, core, []);
  assert.equal(missing.adapter, core); assert.equal(missing.choice.reason, 'specialized_implementation_unavailable');
  assert.deepEqual(missing.choice.snapshot, snapshot);
  const incompatible = resolvePresentationAdapter(descriptor, snapshot, {...preference,version:'2.0.0'}, core, [{...preference, adapter:specialized}]);
  assert.equal(incompatible.adapter, core); assert.equal(incompatible.choice.reason, 'specialized_presentation_unavailable');
  assert.deepEqual(incompatible.choice.snapshot, snapshot);
  assert.throws(() => resolvePresentationAdapter({...descriptor,core:['detail']},snapshot,preference,core,[]), /missing core/);
});
