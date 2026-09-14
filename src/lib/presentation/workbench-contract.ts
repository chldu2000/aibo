/** Snapshot for the replaceable workbench only; host management and window controls
 * are not renderer actions and survive its generation. Host-owned window context. It contains no renderer, native handle, or executable callback. */
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
