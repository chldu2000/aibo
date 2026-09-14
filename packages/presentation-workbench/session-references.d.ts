export type SessionReferenceView = { id: string; title: string; agent: string; note: string; omitted: number | null; excerpts: Array<{role: string; text: string; truncated: boolean}> };
export function splitSessionReferences(content: string): { body: string; references: SessionReferenceView[] };
