import { localizedMessage } from '../../../packages/i18n/index.js';
import type { LocalizedText } from '../../../packages/i18n/index.js';
import type { SetNotice } from './notifications';
import type { CodexThreadSummary, PiSessionTreeSnapshot, Session, Workspace } from '$lib/types';
import { toErrorText } from './error-utils';
import { ensureWorkspaceExpanded, removeWorkspace as removeWorkspaceState } from './session-transitions';

export type WorkspaceControllerContext = {
  api: {
    addWorkspace: (path: string) => Promise<Workspace>;
    setWorkspaceTrust: (workspaceId: string, trusted: boolean) => Promise<Workspace>;
    removeWorkspace: (workspaceId: string) => Promise<void>;
  };
  chooseDirectory: () => Promise<string | null>;
  getDesktop: () => boolean;
  getWorkspaces: () => Workspace[];
  setWorkspaces: (value: Workspace[]) => void;
  getSelectedWorkspaceId: () => string | null;
  getSelectedSessionId: () => string | null;
  getArchivingWorkspaceId: () => string | null;
  getWorkspaceSessions: (workspaceId: string) => Session[];
  getWorkspaceSessionMap: () => Record<string, Session[]>;
  getExpandedWorkspaceIds: () => string[];
  setWorkspaceSessionMap: (value: Record<string, Session[]>) => void;
  setExpandedWorkspaceIds: (value: string[]) => void;
  setSelectedWorkspaceId: (value: string | null) => void;
  setCodexThreads: (value: CodexThreadSummary[]) => void;
  setCodexThreadSnapshot: (value: null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setPiNavigationEntryId: (value: null) => void;
  setWorkspaceCapabilities: (value: import('$lib/types').WorkspaceCapabilityInventory | null) => void;
  clearSelectedSessionContext: () => void;
  refreshSessions: (workspaceId: string) => Promise<void> | void;
  refreshCodexThreads: (workspaceId: string) => Promise<void> | void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: LocalizedText | null) => void;
  setNotice: SetNotice;
  selectWorkspace: (workspaceId: string) => void;
};

export function createWorkspaceController(context: WorkspaceControllerContext) {
  async function createWorkspace(path: string): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      context.setErrorMessage(localizedMessage('workspace.existingDirectory'));
      return;
    }

    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('workspace.saveDesktopOnly'), 'warning');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    context.setNotice(null);
    try {
      const workspace = await context.api.addWorkspace(normalizedPath);
      context.setWorkspaces([
        workspace,
        ...context.getWorkspaces().filter(({ id }) => id !== workspace.id),
      ]);
      context.selectWorkspace(workspace.id);
      context.setNotice(workspace.trust === 'trusted' ? localizedMessage('workspace.addedTrusted') : localizedMessage('workspace.addedUntrusted'), workspace.trust === 'trusted' ? 'success' : 'warning');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function chooseWorkspaceDirectory(): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('workspace.pickerDesktopOnly'), 'warning');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const selectedPath = await context.chooseDirectory();
      if (selectedPath?.trim()) await createWorkspace(selectedPath);
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function toggleTrust(workspace: Workspace): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('workspace.trustDesktopOnly'), 'warning');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const updated = await context.api.setWorkspaceTrust(
        workspace.id,
        workspace.trust !== 'trusted',
      );
      context.setWorkspaces(
        context.getWorkspaces().map((item) => (item.id === updated.id ? updated : item)),
      );
      context.setNotice(updated.trust === 'trusted' ? localizedMessage('workspace.trusted') : localizedMessage('workspace.untrusted'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  async function deleteWorkspace(workspace: Workspace): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('workspace.removeDesktopOnly'), 'warning');
      return;
    }
    if (workspace.id === context.getArchivingWorkspaceId()) return;

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const deletingSelectedWorkspace = context.getSelectedWorkspaceId() === workspace.id;
      const deletingSelectedSession = Boolean(
        context.getSelectedSessionId() &&
          context.getWorkspaceSessions(workspace.id).some(({ id }) => id === context.getSelectedSessionId()),
      );
      await context.api.removeWorkspace(workspace.id);
      context.setWorkspaces(context.getWorkspaces().filter(({ id }) => id !== workspace.id));
      context.setWorkspaceSessionMap(removeWorkspaceState(context.getWorkspaceSessionMap(), workspace.id));
      context.setExpandedWorkspaceIds(
        context.getExpandedWorkspaceIds().filter((id) => id !== workspace.id),
      );
      const remainingWorkspaces = context.getWorkspaces();
      const nextSelectedWorkspaceId = deletingSelectedWorkspace
        ? (remainingWorkspaces[0]?.id ?? null)
        : context.getSelectedWorkspaceId();
      context.setSelectedWorkspaceId(nextSelectedWorkspaceId);
      if (deletingSelectedSession) context.clearSelectedSessionContext();
      if (deletingSelectedWorkspace) {
        context.setCodexThreads([]);
        context.setCodexThreadSnapshot(null);
        context.setPiTree(null);
        context.setPiNavigationEntryId(null);
        context.setWorkspaceCapabilities(null);
      }
      if (deletingSelectedWorkspace && nextSelectedWorkspaceId) {
        context.setExpandedWorkspaceIds(
          ensureWorkspaceExpanded(context.getExpandedWorkspaceIds(), nextSelectedWorkspaceId),
        );
        void context.refreshSessions(nextSelectedWorkspaceId);
        void context.refreshCodexThreads(nextSelectedWorkspaceId);
      }
      context.setNotice(localizedMessage('workspace.removed'), 'success');
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { createWorkspace, chooseWorkspaceDirectory, toggleTrust, deleteWorkspace };
}
