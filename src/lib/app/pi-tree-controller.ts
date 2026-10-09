import { localizedMessage } from '../../../packages/i18n/index.js';
import type { LocalizedText } from '../../../packages/i18n/index.js';
import type { SetNotice } from './notifications';
import type {
  PiSessionTreeNavigation,
  PiTreeNavigationOptions,
  PiSessionTreeSnapshot,
  Session,
  TimelineItem,
} from '$lib/types';
import { toErrorText } from './error-utils';
import { createAgentFacade } from './agent-facade';

export type PiTreeControllerContext = {
  api: {
    navigatePiSessionTree: (
      sessionId: string,
      entryId: string,
      options: PiTreeNavigationOptions,
    ) => Promise<PiSessionTreeNavigation>;
    invokeAgentCapability: (sessionId: string, capability: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getTimeline: (sessionId: string) => Promise<TimelineItem[]>;
  };
  getDesktop: () => boolean;
  getSelectedSession: () => Session | null;
  getSelectedSessionId: () => string | null;
  getSessionRunning: () => boolean;
  getPiTree: () => PiSessionTreeSnapshot | null;
  getPendingEntryId: () => string | null;
  setPendingEntryId: (value: string | null) => void;
  setPiTree: (value: PiSessionTreeSnapshot | null) => void;
  setTimeline: (value: TimelineItem[]) => void;
  setComposerText: (value: string) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: LocalizedText | null) => void;
  setNotice: SetNotice;
};

/** Coordinates Pi branch selection and navigation without owning page state. */
export function createPiTreeController(context: PiTreeControllerContext) {
  const agent = createAgentFacade(context.api);
  function requestNavigation(entryId: string): void {
    const session = context.getSelectedSession();
    if (
      !session ||
      !session.capabilities.includes('session.tree') ||
      context.getSessionRunning() ||
      entryId === context.getPiTree()?.leafId
    ) {
      return;
    }
    context.setPendingEntryId(entryId);
  }

  async function confirmNavigation(options: PiTreeNavigationOptions): Promise<boolean> {
    const entryId = context.getPendingEntryId();
    const sessionId = context.getSelectedSessionId();
    context.setPendingEntryId(null);
    const session = context.getSelectedSession();
    if (!entryId || !sessionId || !session || !session.capabilities.includes('session.tree')) return false;
    if (!context.getDesktop()) {
      context.setNotice(localizedMessage('tree.desktopOnly'), 'warning');
      return false;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const result = await agent.invoke(session, 'session.tree', {
        action: 'navigate', entryId, summarize: options.mode !== 'none',
        customInstructions: options.mode === 'custom' ? options.customInstructions?.trim() || null : null,
      });
      const navigation: PiSessionTreeNavigation = {
        sessionId,
        externalSessionId: typeof result.externalSessionId === 'string' ? result.externalSessionId : null,
        leafId: typeof result.leafId === 'string' ? result.leafId : null,
        tree: Array.isArray(result.tree) ? result.tree as PiSessionTreeNavigation['tree'] : [],
        cancelled: result.cancelled === true,
        editorText: typeof result.editorText === 'string' ? result.editorText : null,
      };
      if (navigation.cancelled) {
        context.setNotice(localizedMessage('tree.cancelled'), 'info');
        return false;
      } else {
        if (context.getSelectedSessionId() !== sessionId) return false;
        context.setPiTree(navigation);
        const timeline = await context.api.getTimeline(sessionId);
        if (context.getSelectedSessionId() !== sessionId) return false;
        context.setTimeline(timeline);
        if (navigation.editorText !== null) context.setComposerText(navigation.editorText);
        context.setNotice(localizedMessage('tree.switched'), 'success');
        return true;
      }
    } catch (error) {
      context.setErrorMessage(toErrorText(error));
      return false;
    } finally {
      context.setBusy(false);
    }
  }

  return { requestNavigation, confirmNavigation };
}
