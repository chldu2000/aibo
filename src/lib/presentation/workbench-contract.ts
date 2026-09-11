/** Host-owned window context. It contains no renderer, native handle, or executable callback. */
export type WorkbenchSnapshot = {
  workspaceId: string | null;
  sessionId: string | null;
  draft: string;
  navigation: string | null;
  timelineRevision: number;
};
export type WorkbenchAction = {
  id: string;
  workspaceId: string | null;
  sessionId: string | null;
};
