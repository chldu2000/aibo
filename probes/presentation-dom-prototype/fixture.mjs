// Throwaway P0 fixture. No provider, filesystem or actual send operation is connected.
export function conversation() {
  return {
    workspace: { id: 'p0-workspace', label: 'Prototype workspace', path: '/prototype', trust: 'trusted' },
    session: { id: 'p0-session', workspaceId: 'p0-workspace', agent: 'third-party', label: 'Prototype session', state: 'idle', archived: false, externalSessionId: null, pluginInstallationId: 'p0-installation', capabilities: [], createdAt: '', updatedAt: '' },
    goal: null, thread: null, timeline: [{ id: 'p0-message', turnId: null, role: 'assistant', toolName: null, entryType: null, content: 'Same host snapshot, different framework.', status: 'completed' }],
    timelineVisibleCount: 1, usage: null, retryPrompt: null, retryReason: null, userInputRequests: [], answerDrafts: {}, queue: null, activityLabel: null,
    compacting: false, running: false, archiving: false, busy: false, attachments: [], executionProfile: null,
    modelConfiguration: { currentReasoningEffort: null, selectedReasoningEffort: null, defaultAction: 'preserve' },
    modelCatalog: null, modelCatalogLoading: false, modelOverride: null, workspacePathSuggestions: [], agentCommands: [], agentCommandsLoading: false,
    draft: '跨框架保留的草稿', draftFailed: false, tree: null, treeOpen: false, treeNavigationStatus: null,
  };
}
