import {nativeTextWithSuffix} from './native-text.ts';
/** Host-owned search: sources return data; activation is revalidated by composition. */
import { LocalizedError, toErrorText, readNativeMessage } from './error-utils.ts';
import { localizedMessage, translate, translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText } from '../../../packages/i18n/index.js';
export const searchKinds = ['workspace', 'session', 'message', 'file', 'command', 'setting', 'plugin', 'attachment', 'artifact', 'execution'] as const;
export type SearchKind = typeof searchKinds[number];
export function localizedSearchKindLabels(locale: Locale): Record<SearchKind, string> {
  return Object.fromEntries(searchKinds.map(kind => [kind, translate(locale, `search.kind.${kind}`)])) as Record<SearchKind, string>;
}
export const searchKindLabels: Record<SearchKind, string> = {
  workspace: '工作区', session: '会话', message: '消息', file: '文件', command: '命令',
  setting: '设置', plugin: '插件', attachment: '附件', artifact: '产物', execution: '执行记录',
};
export type SearchTarget = {
  source: string; id: string; workspaceId?: string | null; sessionId?: string | null;
  path?: string; line?: number;
};
export type SearchResult = {
  id: string; kind: SearchKind; title: string; description: string; excerpt?: string;
  target: SearchTarget; score: number; disabledReason?: string; shortcut?: string;
  localizedTitle?: unknown; localizedDescription?: unknown;
  hostCatalog?: boolean;
};
export type SearchRequest = { query: string; kind: SearchKind | null; workspaceId: string | null; limit: number };
export type SearchPage = { items: SearchResult[]; hasMore: boolean; warnings: string[]; localizedWarnings?: unknown };
export type SearchState = {
  query: string; kind: SearchKind | null; workspaceId: string | null; limit: number;
  items: SearchResult[]; pending: string[]; errors: LocalizedText[]; warnings: LocalizedText[]; hasMore: boolean;
};
export type SearchSource = { id: string; label?: LocalizedText; search(request: SearchRequest, signal: AbortSignal): Promise<SearchPage> };
export const emptySearch = (): SearchState => ({ query: '', kind: null, workspaceId: null, limit: 50, items: [], pending: [], errors: [], warnings: [], hasMore: false });

export function searchPresentation(state: SearchState, locale: Locale, catalog: SearchResult[] = []) {
  const current = new Map(catalog.map(item => [item.id, item]));
  return { ...state, items: state.items.map(({localizedTitle, localizedDescription, hostCatalog, ...item}) => {
    const candidate = hostCatalog ? current.get(item.id) : undefined;
    const display = candidate && JSON.stringify(candidate.target) === JSON.stringify(item.target) ? candidate : undefined;
    return {...item,
      title: display?.title ?? translateMessage(locale, readNativeMessage(localizedTitle) ?? item.title),
      description: display?.description ?? translateMessage(locale, readNativeMessage(localizedDescription) ?? item.description),
      disabledReason: display ? display.disabledReason : item.disabledReason,
    };
  }) };
}
export function searchPreviewPresentation<T extends {content: string; localizedContent?: unknown; localizedSuffix?: unknown}>(preview: T | null, locale: Locale): Omit<T, 'localizedContent' | 'localizedSuffix'> | null {
  if (!preview) return null;
  const {localizedContent, localizedSuffix, ...value} = preview;
  return {...value, content: translateMessage(locale, readNativeMessage(localizedContent) ?? nativeTextWithSuffix(value.content, localizedSuffix, locale))};
}
export function parseSearch(query: string, kind: SearchKind | null): { query: string; kind: SearchKind | null } {
  const trimmed = query.trim();
  return { query: /^[>@]/.test(trimmed) ? trimmed.slice(1).trim() : trimmed,
    kind: trimmed.startsWith('>') ? 'command' : trimmed.startsWith('@') ? 'session' : kind };
}
export function matchSearch(title: string, description: string, query: string): number {
  const needle = query.trim().toLocaleLowerCase(), label = title.toLocaleLowerCase();
  if (!needle) return 1;
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 90;
  if (label.includes(needle)) return 75;
  if (`${label} ${description.toLocaleLowerCase()}`.includes(needle)) return 50;
  if (needle.length < 2 || needle.includes(' ')) return 0;
  let index = 0;
  for (const char of label) if (char === needle[index]) index++;
  return index === needle.length ? 20 : 0;
}
export function searchCatalog(items: SearchResult[], request: SearchRequest): SearchPage {
  const matches = items.filter(item => (!request.kind || item.kind === request.kind)
    && (!request.workspaceId || !item.target.workspaceId || item.target.workspaceId === request.workspaceId))
    .map(item => ({ ...item, hostCatalog: true, score: matchSearch(item.title, item.description, request.query) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { items: matches.slice(0, request.limit), hasMore: matches.length > request.limit, warnings: [] };
}
export function createSearchController(ports: { sources: SearchSource[]; publish(state: SearchState): void; recent?: () => string[]; currentWorkspace?: () => string | null }) {
  let state = emptySearch(), generation = 0, abort: AbortController | undefined;
  let pages = new Map<string, SearchPage>();
  const publish = () => {
    const recent = ports.recent?.() ?? [], current = ports.currentWorkspace?.();
    const unique = new Map<string, SearchResult>();
    for (const page of pages.values()) for (const item of page.items) unique.set(item.id, item);
    state = { ...state, items: [...unique.values()].sort((a, b) => {
      const boost = (item: SearchResult) => (item.target.workspaceId === current ? 3 : 0) + (recent.includes(item.id) ? 5 - recent.indexOf(item.id) / 20 : 0);
      return (b.score + boost(b)) - (a.score + boost(a)) || a.id.localeCompare(b.id);
    }), hasMore: [...pages.values()].some(page => page.hasMore), warnings: [...pages.values()].flatMap(page => {
      const metadata = Array.isArray(page.localizedWarnings) && page.localizedWarnings.length === page.warnings.length ? page.localizedWarnings : [];
      return page.warnings.map((text, index) => readNativeMessage(metadata[index]) ?? text);
    }) };
    ports.publish(state);
  };
  return {
    close() { generation++; abort?.abort(); },
    async search(query: string, kind: SearchKind | null = null, workspaceId: string | null = null, limit = 50): Promise<void> {
      abort?.abort(); abort = new AbortController(); const signal = abort.signal, revision = ++generation;
      pages = new Map(); state = { ...emptySearch(), query, kind, workspaceId, limit, pending: ports.sources.map(source => source.id) }; publish();
      const request = { ...parseSearch(query, kind), workspaceId, limit };
      await Promise.all(ports.sources.map(async source => {
        try {
          const page = await source.search(request, signal);
          if (revision !== generation) return;
          if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean' || !Array.isArray(page.warnings)
            || page.warnings.some(message => typeof message !== 'string') || page.items.some(item => !item || typeof item.id !== 'string'
              || !searchKinds.includes(item.kind) || typeof item.title !== 'string' || typeof item.description !== 'string'
              || !Number.isFinite(item.score) || !item.target || typeof item.target.source !== 'string' || typeof item.target.id !== 'string')) throw new LocalizedError('search.sourceInvalid');
          pages.set(source.id, page);
        } catch (error) {
          if (revision !== generation) return;
          state = { ...state, errors: [...state.errors, localizedMessage('search.sourceError',{source:source.label??source.id,error:toErrorText(error)})] };
        } finally {
          if (revision === generation) { state = { ...state, pending: state.pending.filter(id => id !== source.id) }; publish(); }
        }
      }));
    },
  };
}

/** Two completed taps; typing, chords, IME, repeats and blur break the sequence. */
export function createDoubleShift(maxInterval = 400) {
  let pressed: number | null = null, previous: number | null = null;
  const reset = () => { pressed = null; previous = null; };
  return { reset, handle(event: { type: string; key: string; repeat?: boolean; isComposing?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }, now: number): boolean {
    if (event.key !== 'Shift' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) { reset(); return false; }
    if (event.type === 'keydown') { if (pressed !== null) reset(); pressed = now; return false; }
    if (event.type !== 'keyup' || pressed === null || now - pressed > maxInterval) { reset(); return false; }
    pressed = null;
    if (previous !== null && now - previous <= maxInterval) { reset(); return true; }
    previous = now; return false;
  } };
}
