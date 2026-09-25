import {Lexer} from 'marked';
import {decodeHTML} from 'entities';

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;
const options = {gfm: true, breaks: true};

// Only data leaves the lexer. HTML is displayed literally, never interpreted.
function segments(tokens) {
  return tokens.filter(token => token.type !== 'checkbox').map(token => {
    if (token.type === 'html') return {kind: 'text', value: token.raw};
    if (token.type === 'br') return {kind: 'text', value: '\n'};
    if (token.type === 'codespan') return {kind: 'code', value: token.text};
    if (['strong', 'em', 'del'].includes(token.type)) {
      return {kind: token.type, value: token.text, children: segments(token.tokens)};
    }
    if (token.type === 'link' || token.type === 'image') {
      const href = decodeHTML(token.href);
      if (!SAFE_LINK.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return {kind: 'text', value: token.raw};
      // Images stay explicit links: remote fetching is not part of Markdown rendering.
      const children = token.type === 'image'
        ? [{kind: 'text', value: `图片：${decodeHTML(token.text) || href}`}]
        : segments(token.tokens);
      return {kind: 'link', value: decodeHTML(token.text), href, children};
    }
    return {kind: 'text', value: decodeHTML(token.text ?? token.raw)};
  });
}

export function inlineSegments(value) {
  return segments(Lexer.lexInline(value, options));
}

export function parseMarkdown(value) {
  let index = 0;
  function blocks(tokens) {
    return tokens.filter(token => !['space', 'def', 'checkbox'].includes(token.type)).map(token => {
      const base = {index: index++, lines: [token.text ?? token.raw]};
      if (token.type === 'code') return {...base, kind: 'code', lines: token.text.split('\n'), language: (token.lang ?? '').split(/\s+/)[0]};
      if (token.type === 'heading') return {...base, kind: 'heading', level: token.depth, segments: segments(token.tokens)};
      if (token.type === 'hr') return {...base, kind: 'rule'};
      if (token.type === 'blockquote') return {...base, kind: 'quote', blocks: blocks(token.tokens)};
      if (token.type === 'list') return {...base, kind: 'list', ordered: token.ordered, start: token.ordered ? token.start : 1,
        lines: token.items.map(item => item.text),
        items: token.items.map(item => ({checked: item.task ? Boolean(item.checked) : null, blocks: blocks(item.tokens)}))};
      if (token.type === 'table') return {...base, kind: 'table', align: token.align,
        header: token.header.map(cell => segments(cell.tokens)), rows: token.rows.map(row => row.map(cell => segments(cell.tokens)))};
      return {...base, kind: 'paragraph', segments: token.type === 'html'
        ? [{kind: 'text', value: token.raw}] : segments(token.tokens ?? [{type: 'text', text: token.text ?? token.raw}])};
    });
  }
  return blocks(Lexer.lex(value.replace(/\r\n?/g, '\n'), options));
}

export function displayMarkdown(content) {
  return content.replace(/\n?\[AIBO_CONTEXT_ATTACHMENTS\][\s\S]*?\[\/AIBO_CONTEXT_ATTACHMENTS\]/g, '').trimEnd();
}

export function markdownTargets(content) {
  const targets = [], links = new Set();
  function visitInline(values, index) {
    for (const segment of values) {
      if (segment.kind === 'link' && !links.has(segment.href)) {
        links.add(segment.href);
        targets.push({kind: 'link', index, value: segment.href});
      }
      if (segment.children) visitInline(segment.children, index);
    }
  }
  function visit(blocks) {
    for (const block of blocks) {
      if (block.kind === 'code') targets.push({kind: 'code', index: block.index, value: block.lines.join('\n')});
      if (block.segments) visitInline(block.segments, block.index);
      if (block.kind === 'table') for (const row of [block.header, ...block.rows]) for (const cell of row) visitInline(cell, block.index);
      if (block.blocks) visit(block.blocks);
      if (block.items) for (const item of block.items) visit(item.blocks);
    }
  }
  visit(parseMarkdown(displayMarkdown(content)));
  return targets;
}
