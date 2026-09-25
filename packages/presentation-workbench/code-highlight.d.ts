export type CodeSegment = {value?: string; className?: string; children?: CodeSegment[]};
export function highlightCode(value: string, language: string): CodeSegment[];
