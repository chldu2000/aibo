export interface TimelineEntry {
  id: string;
  role: string;
  toolName: string | null;
  entryType: string | null;
  content: string;
}
export type TimelineRenderItem<T extends TimelineEntry = TimelineEntry> =
  | { kind: 'entry'; id: string; item: T }
  | { kind: 'tool-group' | 'system-group'; id: string; items: T[] };
export function groupTimelineItems<T extends TimelineEntry>(items: T[], groupSystemItems?: boolean): TimelineRenderItem<T>[];
export function toolLabel(item: TimelineEntry): string;
export function isDiffContent(content: string): boolean;
