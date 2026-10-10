import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite'))('postcss');

// Static counterpart of probes/lib/material3-token-scan.mjs: every declaration in the Material 3
// stylesheets, including UI no probe opens, must resolve to official M3 system tokens.
const catalog = JSON.parse(await readFile('src/lib/ui-kit/kits/material3/themes.json', 'utf8'));
const official = JSON.parse(await readFile('probes/fixtures/material3-official-tokens.json', 'utf8'));
const files = ['src/lib/ui-kit/kits/material3.css', ...(await readdir('src/lib/ui-kit/kits/material3'))
  .filter(name => name.endsWith('.css')).map(name => `src/lib/ui-kit/kits/material3/${name}`)];
const sheets = await Promise.all(files.map(async file => ({ file, root: postcss.parse(await readFile(file, 'utf8')) })));

// Every definition of each custom property: the kit catalog, every theme, and the stylesheets themselves.
const definitions = new Map();
const define = (name, value) => definitions.set(name, [...(definitions.get(name) ?? []), value]);
for (const [name, value] of Object.entries(catalog.tokens)) define(name, value);
for (const theme of catalog.themes) for (const [name, value] of Object.entries(theme.tokens)) define(name, value);
for (const { root } of sheets) root.walkDecls(/^--/, declaration => define(declaration.prop, declaration.value));

const shapeScale = new Set(Object.values(official.sys.shape).filter(value => typeof value === 'number' && value < 9999));
shapeScale.add(official.comp.checkbox['container-shape']); // checkbox container
shapeScale.add(3); // primary tab active-indicator shape: 3px 3px 0 0
const typeScale = new Set([11, 12, 14, 16, 22, 24, 28, 32, 36, 45, 57]);
const opacities = new Set([8, 10, 12, 16, 32, 38]);
const ROLE = /^--md-sys-color-[a-z-]+$|^--aibo-(success|warning)-(text|surface|border)$/;
const STATE = /^--md-sys-(state-[a-z-]+-opacity|scrim-opacity)$/;
const keywords = new Set(['transparent', 'currentColor', 'currentcolor', 'inherit', 'initial', 'unset', 'none']);

// Splits on top-level separators while keeping var()/color-mix() intact.
function split(value, separator = /\s/) {
  const parts = []; let depth = 0, current = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth === 0 && separator.test(char)) { if (current.trim()) parts.push(current.trim()); current = ''; }
    else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
const varName = value => /^var\((--[\w-]+)(?:,.*)?\)$/s.exec(value)?.[1];
function resolves(name, check, seen = new Set()) {
  if (seen.has(name)) return true;
  seen.add(name);
  const values = definitions.get(name);
  return Boolean(values?.length) && values.every(value => check(value.trim(), seen));
}

function colorOk(value, seen = new Set()) {
  if (keywords.has(value)) return true;
  const name = varName(value);
  if (name) return ROLE.test(name) ? true : resolves(name, colorOk, seen);
  if (/^#[0-9a-f]{6}$/i.test(value)) return false; // raw colours only exist as role definitions
  const mix = /^color-mix\(in srgb,\s*(.+)\)$/s.exec(value);
  if (mix) {
    const [first, second] = split(mix[1], /,/);
    const [color, amount = '100%'] = split(first);
    const percent = /^(\d+)%$/.exec(amount)?.[1];
    const amountOk = percent ? opacities.has(Number(percent)) : STATE.test(varName(amount) ?? '');
    return colorOk(color, seen) && amountOk && second === 'transparent';
  }
  if (/^linear-gradient\(/.test(value)) return split(value.slice(16, -1), /,/).every(stop => colorOk(stop, seen));
  return false;
}
// Role definitions themselves are the palette; a role is valid by construction.
const isRoleDefinition = (prop) => ROLE.test(prop);

const lengthOk = (value, scale) => {
  const px = /^(\d*\.?\d+)px$/.exec(value)?.[1], rem = /^(\d*\.?\d+)rem$/.exec(value)?.[1];
  return px !== undefined ? scale.has(Number(px)) : rem !== undefined ? scale.has(Number(rem) * 16) : false;
};
function radiusOk(value, seen = new Set()) {
  if (value === '0' || value === '50%' || value === 'inherit') return true;
  if (/^9{3,}px$/.test(value)) return true; // corner-full
  const name = varName(value);
  if (name) return /^--md-sys-shape-corner-/.test(name) || resolves(name, (v, s) => split(v).every(part => radiusOk(part, s)), seen);
  return lengthOk(value, shapeScale);
}
function sizeOk(value, seen = new Set()) {
  if (value === 'inherit' || value === '0') return true;
  const name = varName(value);
  if (name) return resolves(name, sizeOk, seen);
  return lengthOk(value, typeScale);
}
const weightOk = value => ['400', '500', '700', 'normal', 'inherit'].includes(value);
function shadowOk(value, seen = new Set()) {
  if (value === 'none') return true;
  const name = varName(value);
  if (name) return /^--md-sys-elevation-level[0-5]$/.test(name) || resolves(name, shadowOk, seen);
  if (/^0 \d+px \d+px( \d+px)? 0? ?rgb\(0 0 0 \/ \.(3|15)\)/.test(value)) return true; // elevation level definitions
  return split(value, /,/).every(layer => {
    // Rings and edge lines stand in for borders and drop indicators; they still use roles.
    const parts = split(layer).filter(part => part !== 'inset');
    const ring = parts.length === 5 && parts.slice(0, 3).every(part => part === '0');
    const edge = parts.length === 3 && parts[0] === '0' && /^-?\d+px$/.test(parts[1]);
    return (ring || edge) && colorOk(parts.at(-1), seen);
  });
}
// Shorthand parts that are lengths (widths, offsets) rather than colours.
const isLength = (value, seen = new Set()) => /^-?\d*\.?\d+(px|rem|em|%)?$/.test(value)
  || Boolean(varName(value)) && resolves(varName(value), (v, s) => isLength(v, s), seen);
const colorPart = part => /^(var\(|color-mix\(|#|rgb|hsl|transparent$|currentColor$|currentcolor$)/.test(part) && !isLength(part);

test('every Material 3 declaration draws with official colour roles, shapes, type and elevation', () => {
  const failures = [];
  for (const { file, root } of sheets) root.walkDecls(declaration => {
    const { prop } = declaration, value = declaration.value.replace(/\s*!important$/, '').trim();
    const at = `${file}:${declaration.source.start.line} ${prop}: ${value}`;
    if (prop.startsWith('--')) {
      if (/^--md-sys-color-|-color$|^--aibo-(hover|selected|selected-ink)$|^--md-(control|switch)-(ink|layer|handle-color)$|^--md-state-layer$/.test(prop) && !colorOk(value)) failures.push(at);
      return;
    }
    if (/^(color|background-color|border(-(top|right|bottom|left))?-color|outline-color|caret-color|fill|stroke|accent-color|text-decoration-color)$/.test(prop)) {
      if (!split(value).every(part => colorOk(part))) failures.push(at);
    } else if (/^(background|border(-(top|right|bottom|left))?|outline|background-image|scrollbar-color)$/.test(prop)) {
      if (!split(value).filter(colorPart).every(part => colorOk(part))) failures.push(at);
    } else if (/radius$/.test(prop)) {
      if (!split(value).every(part => radiusOk(part))) failures.push(at);
    } else if (prop === 'font-size') {
      if (!sizeOk(value)) failures.push(at);
    } else if (prop === 'font-weight') {
      if (!weightOk(value)) failures.push(at);
    } else if (prop === 'font') {
      const parts = split(value), weight = parts.find(part => /^\d{3}$/.test(part)), size = parts.find(part => /px|rem|var\(--(aibo-type|md-aibo-type)/.test(part))?.split('/')[0];
      if ((weight && !weightOk(weight)) || (size && !sizeOk(size))) failures.push(at);
    } else if (prop === 'box-shadow') {
      if (!shadowOk(value)) failures.push(at);
    }
  });
  assert.deepEqual(failures, [], `off-token Material 3 declarations:\n${failures.join('\n')}`);
});

test('theme role and token definitions resolve to the official system', () => {
  const failures = [];
  for (const [name, values] of definitions) for (const value of values) {
    if (isRoleDefinition(name)) { if (!/^#[0-9a-f]{6}$/i.test(value) && !ROLE.test(varName(value) ?? '')) failures.push(`${name}: ${value}`); continue; }
    if (/^--md-sys-shape-corner-/.test(name) && !split(value).every(part => radiusOk(part))) failures.push(`${name}: ${value}`);
    if (/^--md-sys-elevation-/.test(name) && !shadowOk(value)) failures.push(`${name}: ${value}`);
    if (/^--(aibo|md-aibo)-type-(body|ui|meta|label-size|data-size|title-size|display-size)$/.test(name) && !sizeOk(value)) failures.push(`${name}: ${value}`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
