export type SessionReferenceView = { id: string; title: string; agent: string; note: string; mode: 'complete' | 'excerpts' | 'legacy'; messageLimit: number | null; omitted: number | null; excerpts: Array<{role: string; text: string; truncated: boolean}> };
export function splitSessionReferences(content: string): { body: string; references: SessionReferenceView[] };
