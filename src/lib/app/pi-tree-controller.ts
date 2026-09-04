import type {
  PiSessionTreeNavigation,
  PiSessionTreeSnapshot,
  Session,
  TimelineItem,
} from '$lib/types';
import { toErrorMessage } from './error-utils';

export type PiTreeControllerContext = {
  api: {
    navigatePiSessionTree: (
      sessionId: string,
      entryId: string,
    ) => Promise<PiSessionTreeNavigation>;
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
      session.agent !== 'pi' ||
      context.getSessionRunning() ||
      entryId === context.getPiTree()?.leafId
    ) {
      return;
    }
    context.setPendingEntryId(entryId);
  }

  async function confirmNavigation(): Promise<void> {
    const entryId = context.getPendingEntryId();
    const sessionId = context.getSelectedSessionId();
    context.setPendingEntryId(null);
    const session = context.getSelectedSession();
    if (!entryId || !sessionId || !session || session.agent !== 'pi') return;
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；Pi 分支切换需要在 Tauri 桌面模式中执行。');
      return;
    }

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      const navigation = await context.api.navigatePiSessionTree(sessionId, entryId);
      if (navigation.cancelled) {
        context.setNotice('Pi 分支切换已取消。');
      } else {
        context.setPiTree(navigation);
        context.setTimeline(await context.api.getTimeline(sessionId));
        if (navigation.editorText !== null) context.setComposerText(navigation.editorText);
        context.setNotice('Pi 会话已切换到选定分支；原分支仍保留在会话树中。');
      }
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { requestNavigation, confirmNavigation };
}
