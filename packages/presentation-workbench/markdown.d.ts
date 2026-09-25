export type InlineSegment = {
  kind: 'text' | 'code' | 'strong' | 'em' | 'del' | 'link';
  value: string;
  href?: string;
  children?: InlineSegment[];
};
type BlockBase = {index: number; lines: string[]};
export type MarkdownBlock = BlockBase & (
  | {kind: 'paragraph'; segments: InlineSegment[]}
  | {kind: 'heading'; level: number; segments: InlineSegment[]}
  | {kind: 'code'; language: string}
  | {kind: 'rule'}
  | {kind: 'quote'; blocks: MarkdownBlock[]}
  | {kind: 'list'; ordered: boolean; start: number; items: {checked: boolean | null; blocks: MarkdownBlock[]}[]}
  | {kind: 'table'; align: ('left' | 'center' | 'right' | null)[]; header: InlineSegment[][]; rows: InlineSegment[][][]}
);
export function parseMarkdown(value: string): MarkdownBlock[];
export function inlineSegments(value: string): InlineSegment[];
export function displayMarkdown(value: string): string;
export function markdownTargets(value: string): {kind: 'code' | 'link'; index: number; value: string}[];
