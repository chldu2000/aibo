import {common, createLowlight} from 'lowlight';

const highlighter = createLowlight(common);
const cache = new Map();

// Explicit languages only; large/unknown blocks remain complete plain text.
export function highlightCode(value, language) {
  if (value.length > 50000 || !language || !highlighter.registered(language)) return [{value}];
  const key = language + '\n' + value;
  if (cache.has(key)) return cache.get(key);
  const convert = nodes => nodes.map(node => node.type === 'text' ? {value: node.value}
    : {className: (node.properties.className ?? []).join(' '), children: convert(node.children)});
  let result;
  try { result = convert(highlighter.highlight(language, value).children); }
  catch { return [{value}]; }
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
