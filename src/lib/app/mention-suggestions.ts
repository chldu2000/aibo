import type { Session, WorkspacePathSuggestion } from '$lib/types';

export type MentionCategory = 'all' | 'files' | 'folders' | 'sessions';

export type MentionSuggestion =
  | { kind: 'session'; session: Session }
  | { kind: 'file' | 'folder'; path: WorkspacePathSuggestion };

export function filterMentionSuggestions(
  sessions: Session[],
  paths: WorkspacePathSuggestion[],
  category: MentionCategory,
  limit = 24,
): MentionSuggestion[] {
  const suggestions: MentionSuggestion[] = [
    ...sessions.map(session => ({ kind: 'session' as const, session })),
    ...paths.map(path => ({ kind: path.isDirectory ? 'folder' as const : 'file' as const, path })),
  ];
  return suggestions
    .filter(item => category === 'all' || `${item.kind}s` === category)
    .slice(0, limit);
}
