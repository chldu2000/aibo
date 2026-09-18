/** Data owned by the host; visual implementations never receive navigation callbacks. */
export type PresentationNavigation = {
  agentChoices?: { id: string; label: string; icon?: import('./agent-icon.js').AgentIcon }[];
  workspaces: { id: string; label: string; path: string; trust: string }[];
  sessionsByWorkspace: Record<string, { id: string; workspaceId: string; agent: string; canSyncSnapshot?: boolean; label: string; state: string; archived: boolean; updatedAt: string }[]>;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  expandedWorkspaceIds: string[];
  sessionsLoadingWorkspaceIds: string[];
  busy: boolean;
  threadBusy: boolean;
  archivingWorkspaceId: string | null;
  archivingSessionId: string | null;
  sessionSearchOpen: boolean;
  sessionFilterOpen: boolean;
  sessionSearch: string;
  sessionFilter: string;
  createSessionWorkspaceId: string | null;
  renamingSessionId: string | null;
  sessionLabelDraft: string;
};

export type PresentationNavigationOperation =
  | 'toggleSearch' | 'toggleFilter' | 'search' | 'filter' | 'applyFilters' | 'addWorkspace'
  | 'selectWorkspace' | 'toggleSessionCreator' | 'toggleTrust' | 'removeWorkspace' | 'openWorkspace'
  | 'createAgent' | 'selectSession' | 'unarchiveSession' | 'archiveSession'
  | 'syncSession' | 'renameSession' | 'renameDraft' | 'saveRename' | 'cancelRename';

export type PresentationNavigationAction = {
  token: string;
  operation: PresentationNavigationOperation;
  targetId?: string;
  choiceId?: string;
  event: 'click' | 'input' | 'change';
  /** Allowed values for a change event; the host rejects other values. */
  options?: readonly string[];
};
