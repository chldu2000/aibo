/** Experimental wire contract. JSON only; local renderer interfaces live elsewhere. */
export const SEMANTIC_SCHEMA = 'aibo.semantic-view/experimental-v1';
export type Context = { workspaceId: string; contributionId: string; generation: string; revision: number };
export type Action = { id: 'refresh' | 'open-diff' | 'back' | 'next' | 'previous'; label: string; intent: 'refresh' | 'inspect' | 'navigate'; enabled: boolean };
export type ActionMessage = { context: Context; actionId: Action['id']; itemId: string | null };
export type Property = { key: string; label: string; type: 'text' | 'enum'; values: string[] };
export type Item = { id: string; values: Record<string, string> };
export type Collection = { kind: 'collection'; properties: Property[]; items: Item[]; selection: string | null; page: { offset: number; size: number; total: number; truncated: boolean } };
export type Detail = { kind: 'detail'; itemId: string; properties: { label: string; value: string }[]; content: string; truncated: boolean };
export type Snapshot = {
  schema: typeof SEMANTIC_SCHEMA;
  context: Context;
  contribution: { id: string; extensionPoint: 'workspace.tool'; title: string };
  state: { status: 'ready' | 'loading' | 'empty' | 'error' | 'unavailable'; message: string };
  view: Collection | Detail;
  actions: Action[];
};
