// ACP form elicitation (`elicitation/create`, mode `form`) mapped onto host questions. The host
// question model is one answer per question: an option label, or free text when `isOther` is set.
// Schemas that model cannot express faithfully return null and the request is cancelled.
import { pluginError } from './session.mjs';

export const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 32;
// Cross-agent marker for a free-text "custom answer" companion to a select question
// (claude-agent-acp's AskUserQuestion bridge; intentionally not vendor-namespaced).
const CUSTOM_ANSWER = '_askUserQuestionCustomAnswer';
const YES = '是', NO = '否';

const text = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function choices(values) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_OPTIONS) return null;
  const options = values.map(value => value && typeof value === 'object' && !Array.isArray(value)
    ? { value: value.const, label: text(value.title, 200) ?? (typeof value.const === 'string' ? value.const : null), description: text(value.description, 500) }
    : { value, label: typeof value === 'string' ? value : null, description: null });
  if (options.some(option => typeof option.value !== 'string' || !option.label)) return null;
  // Answers come back as labels, so labels must identify exactly one value.
  if (new Set(options.map(option => option.label)).size !== options.length) return null;
  return options;
}

function field(schema) {
  const s = schema && typeof schema === 'object' ? schema : {};
  if (s.type === 'string' && (s.oneOf || s.enum)) {
    const options = choices(s.oneOf ?? s.enum);
    return options && { kind: 'choice', options };
  }
  if (s.type === 'array') {
    const items = s.items && typeof s.items === 'object' ? s.items : {};
    const options = choices(items.anyOf ?? items.oneOf ?? items.enum);
    // The host submits one answer per question; a form that needs more than one pick cannot be met.
    if (!options || (s.minItems ?? 0) > 1) return null;
    return { kind: 'multi', options };
  }
  if (s.type === 'boolean') return { kind: 'boolean', options: [{ value: true, label: YES, description: null }, { value: false, label: NO, description: null }] };
  if (s.type === 'string') return { kind: 'text' };
  if (s.type === 'number' || s.type === 'integer') return { kind: s.type };
  return null;
}

/**
 * Maps an elicitation form to host questions and an `answer` encoder, or returns null when the
 * schema cannot be represented. `answer` receives host answers (`{ [questionId]: [value] }`) and
 * returns the ACP accept response; invalid answers throw `invalid_input` and leave the request pending.
 */
export function elicitationForm(params) {
  const schema = params?.requestedSchema;
  const message = text(params?.message, 4_000);
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || !message) return null;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const entries = Object.entries(schema.properties);
  const companions = new Map();
  for (const [key, property] of entries) {
    const target = property?._meta?.[CUSTOM_ANSWER]?.questionId;
    if (typeof target === 'string' && target !== key && schema.properties[target] && property.type === 'string') companions.set(target, key);
  }
  const companionKeys = new Set(companions.values());
  const fields = [];
  for (const [key, property] of entries) {
    if (companionKeys.has(key)) continue;
    const parsed = field(property);
    if (!parsed) return null;
    fields.push({ key, schema: property, required: required.has(key), companion: companions.get(key), ...parsed });
  }
  if (!fields.length || fields.length > MAX_QUESTIONS) return null;
  const single = fields.length === 1;
  // The host question card has no form-level text, so the message leads the first question.
  const questions = fields.map((f, index) => {
    const title = text(f.schema.title, 120), description = text(f.schema.description, 2_000);
    const own = single ? description : description ?? title ?? f.key;
    let question = index === 0 ? (own ? `${message}\n\n${own}` : message) : own;
    if (f.kind === 'multi') question += '\n\n（可多选；aibo 目前每题只能选择一项）';
    return {
      id: f.key, header: title, question,
      options: (f.options ?? []).map(({ label, description }) => ({ label, description })),
      isOther: !f.options || f.companion !== undefined,
    };
  });

  function answer(answers) {
    if (!answers || typeof answers !== 'object' || Object.keys(answers).some(id => !fields.some(f => f.key === id))) throw pluginError('invalid_input', 'Answer names an unknown question');
    const content = {};
    for (const f of fields) {
      const values = answers[f.key];
      const value = Array.isArray(values) && values.length === 1 && typeof values[0] === 'string' ? values[0].trim() : Array.isArray(values) && values.length === 0 ? '' : null;
      if (value === null) throw pluginError('invalid_input', `Question ${f.key} takes one answer`);
      if (!value) { if (f.required) throw pluginError('invalid_input', `Question ${f.key} is required`); continue; }
      const option = f.options?.find(candidate => candidate.label === value);
      if (option) { content[f.key] = f.kind === 'multi' ? [option.value] : option.value; continue; }
      if (f.companion) {
        // Typed text answers through the companion field; a required select still needs a pick.
        if (f.required) throw pluginError('invalid_input', `Question ${f.key} requires one of its options`);
        content[f.companion] = value; continue;
      }
      if (f.options) throw pluginError('invalid_input', `Question ${f.key} requires one of its options`);
      if (f.kind === 'text') { content[f.key] = checkText(f, value); continue; }
      content[f.key] = checkNumber(f, value);
    }
    return { action: 'accept', content };
  }
  return { title: single ? null : message, questions, answer };
}

function checkText(f, value) {
  const s = f.schema, invalid = () => pluginError('invalid_input', `Question ${f.key} answer does not match its format`);
  if ((s.minLength !== undefined && value.length < s.minLength) || (s.maxLength !== undefined && value.length > s.maxLength)) throw invalid();
  if (s.format === 'email' && !/^[^\s@]+@[^\s@]+$/.test(value)) throw invalid();
  if (s.format === 'uri' && !URL.canParse(value)) throw invalid();
  if (s.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  if (s.format === 'date-time' && Number.isNaN(Date.parse(value))) throw invalid();
  return value;
}

function checkNumber(f, value) {
  const s = f.schema, number = Number(value);
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value) || !Number.isFinite(number) || (f.kind === 'integer' && !Number.isInteger(number))
    || (s.minimum !== undefined && number < s.minimum) || (s.maximum !== undefined && number > s.maximum)) {
    throw pluginError('invalid_input', `Question ${f.key} needs ${f.kind === 'integer' ? 'an integer' : 'a number'}${s.minimum !== undefined || s.maximum !== undefined ? ` in range ${s.minimum ?? '-∞'}–${s.maximum ?? '∞'}` : ''}`);
  }
  return number;
}
