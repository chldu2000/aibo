/** Versioned wire contract. JSON only; local renderer interfaces live elsewhere. */
export const SEMANTIC_SCHEMA = 'aibo.semantic-view/v1';
export type Context = { workspaceId: string | null; sessionId?: string; contributionId: string; generation: string; revision: number };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ReadAction = { id: 'refresh' | 'inspect' | 'open-diff' | 'back' | 'next' | 'previous'; label: string; intent: 'refresh' | 'inspect' | 'navigate'; enabled: boolean };
export type Action = ReadAction | { id: string; label: string; intent: 'execute'; enabled: boolean; input: { [key: string]: JsonValue } };
export type ActionMessage = { context: Context; actionId: Action['id']; itemId: string | null };
export type Property = { key: string; label: string; type: 'text' | 'enum'; values: string[] };
export type Item = { id: string; values: Record<string, string> };
export type Collection = { kind: 'collection'; properties: Property[]; items: Item[]; selection: string | null; page: { offset: number; size: number; total: number; truncated: boolean } };
export type Detail = { kind: 'detail' | 'inspector' | 'settings'; itemId: string; properties: { label: string; value: string }[]; content: string; truncated: boolean };
export type Snapshot = {
  schema: typeof SEMANTIC_SCHEMA | 'aibo.semantic-view/v1.1' | 'aibo.semantic-view/experimental-v1';
  context: Context;
  contribution: { id: string; extensionPoint: 'workspace.tool' | 'session.context' | 'session.action' | 'settings.page' | 'command'; title: string };
  state: { status: 'ready' | 'loading' | 'empty' | 'error' | 'unavailable'; message: string };
  view: Collection | Detail;
  actions: Action[];
};
