export type InlineSegment = { kind: 'text' | 'code' | 'strong' | 'link'; value: string; href?: string };
export type MarkdownBlock =
    | { kind: 'paragraph' | 'heading' | 'list'; lines: string[]; level?: number }
    | { kind: 'code'; lines: string[]; language: string };

export function parseMarkdown(value:string): MarkdownBlock[];
export function inlineSegments(value:string): InlineSegment[];
export function displayMarkdown(value:string): string;
export function markdownTargets(value:string): {kind:'code'|'link';index:number;value:string}[];
