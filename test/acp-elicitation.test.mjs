import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { elicitationForm, MAX_QUESTIONS } from '../packages/acp-adapter/elicitation.mjs';
// worker.mjs imports @aibo/* through the host SDK resolver, as a plugin process does.
await import('../packages/plugin-host/register.mjs');
const { acpAgentConfig } = await import('@aibo/acp-adapter/worker');

const form = (properties, extra = {}) => elicitationForm({ mode: 'form', message: 'Answer please', requestedSchema: { type: 'object', properties, ...extra } });

test('a single question carries the message; multi-select is labelled and answered with one pick', () => {
  const mapped = form({ tags: { type: 'array', description: 'Which tags?', items: { anyOf: [{ const: 'a', title: 'Alpha' }, { const: 'b', title: 'Beta' }] } } });
  assert.equal(mapped.title, null);
  assert.equal(mapped.questions[0].question, 'Answer please\n\nWhich tags?\n\n（可多选；aibo 目前每题只能选择一项）');
  assert.deepEqual(mapped.answer({ tags: ['Beta'] }), { action: 'accept', content: { tags: ['b'] } });
  assert.throws(() => mapped.answer({ tags: ['Gamma'] }), /requires one of its options/, 'no other input without a companion field');
  assert.equal(form({ tags: { type: 'array', minItems: 2, items: { enum: ['a', 'b'] } } }), null, 'a form needing two picks is not offered');
});

test('booleans become yes/no, text formats and optional fields are checked', () => {
  const mapped = form({ ok: { type: 'boolean', title: 'OK?' }, mail: { type: 'string', format: 'email' }, note: { type: 'string', maxLength: 3 } }, { required: ['ok', 'mail'] });
  assert.equal(mapped.title, 'Answer please');
  assert.deepEqual(mapped.questions[0].options.map(option => option.label), ['是', '否']);
  assert.deepEqual(mapped.answer({ ok: ['否'], mail: ['a@b'], note: [''] }), { action: 'accept', content: { ok: false, mail: 'a@b' } });
  assert.throws(() => mapped.answer({ ok: ['是'], mail: ['nope'], note: [] }), /format/);
  assert.throws(() => mapped.answer({ ok: ['是'], mail: ['a@b'], note: ['long'] }), /format/);
  assert.throws(() => mapped.answer({ ok: ['是', '否'], mail: ['a@b'] }), /one answer/);
});

test('a required select with a companion still needs an option', () => {
  const mapped = form({ q: { type: 'string', enum: ['x', 'y'] }, q_custom: { type: 'string', _meta: { _askUserQuestionCustomAnswer: { questionId: 'q' } } } }, { required: ['q'] });
  assert.equal(mapped.questions.length, 1);
  assert.throws(() => mapped.answer({ q: ['z'] }), /requires one of its options/);
  assert.deepEqual(mapped.answer({ q: ['y'] }), { action: 'accept', content: { q: 'y' } });
});

test('forms the host cannot express faithfully are rejected', () => {
  assert.equal(form({ a: { type: 'string', oneOf: [{ const: 'x', title: 'Same' }, { const: 'y', title: 'Same' }] } }), null, 'labels must map back to one value');
  assert.equal(form({ a: { type: 'object' } }), null);
  assert.equal(form(Object.fromEntries(Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => [`f${i}`, { type: 'string' }]))), null, 'questions are never truncated');
  assert.equal(elicitationForm({ message: '', requestedSchema: { type: 'object', properties: { a: { type: 'string' } } } }), null);
});

test('acp.json elicitation requires the manifest user-input.respond operation', () => {
  const manifest = JSON.parse(readFileSync('fixtures/plugins/acp-echo/plugin.json', 'utf8'));
  const config = JSON.parse(readFileSync('fixtures/plugins/acp-echo/acp.json', 'utf8'));
  assert.equal(acpAgentConfig(config, manifest).elicitation, true);
  const without = { ...manifest, contributions: [{ ...manifest.contributions[0], operations: manifest.contributions[0].operations.filter(op => !op.capability.id.endsWith('user-input.respond')) }] };
  assert.throws(() => acpAgentConfig(config, without), /user-input.respond operation/);
});
