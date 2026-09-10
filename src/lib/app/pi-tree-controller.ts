import type {
  PiSessionTreeNavigation,
  PiTreeNavigationOptions,
  PiSessionTreeSnapshot,
  Session,
  TimelineItem,
} from '$lib/types';
import { toErrorMessage } from './error-utils';
import { sessionAgentKind } from './agent-kind';

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
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
};

/** Coordinates Pi branch selection and navigation without owning page state. */
export function createPiTreeController(context: PiTreeControllerContext) {
  function requestNavigation(entryId: string): void {
    const session = context.getSelectedSession();
    if (
      !session ||
      (sessionAgentKind(session) !== 'pi' && !session.capabilities.includes('session.tree')) ||
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
    if (!entryId || !sessionId || !session || (sessionAgentKind(session) !== 'pi' && !session.capabilities.includes('session.tree'))) return false;
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；Pi 分支切换需要在 Tauri 桌面模式中执行。');
      return false;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const result = session.pluginInstallationId
        ? await context.api.invokeAgentCapability(sessionId, 'session.tree', {
          action: 'navigate', entryId, summarize: options.mode !== 'none',
          customInstructions: options.mode === 'custom' ? options.customInstructions?.trim() || null : null,
        })
        : await context.api.navigatePiSessionTree(sessionId, entryId, options);
      const navigation: PiSessionTreeNavigation = session.pluginInstallationId ? {
        sessionId,
        externalSessionId: typeof result.externalSessionId === 'string' ? result.externalSessionId : null,
        leafId: typeof result.leafId === 'string' ? result.leafId : null,
        tree: Array.isArray(result.tree) ? result.tree as PiSessionTreeNavigation['tree'] : [],
        cancelled: result.cancelled === true,
        editorText: typeof result.editorText === 'string' ? result.editorText : null,
      } : result as PiSessionTreeNavigation;
      if (navigation.cancelled) {
        context.setNotice('Pi 分支切换已取消。');
        return false;
      } else {
        if (context.getSelectedSessionId() !== sessionId) return false;
        context.setPiTree(navigation);
        const timeline = await context.api.getTimeline(sessionId);
        if (context.getSelectedSessionId() !== sessionId) return false;
        context.setTimeline(timeline);
        if (navigation.editorText !== null) context.setComposerText(navigation.editorText);
        context.setNotice('Pi 会话已切换到选定分支；原分支仍保留在会话树中。');
        return true;
      }
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
      return false;
    } finally {
      context.setBusy(false);
    }
  }

  return { requestNavigation, confirmNavigation };
}
