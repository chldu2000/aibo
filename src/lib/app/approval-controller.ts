import type { ApprovalDecision, ApprovalRequest } from '$lib/types';
import { toErrorMessage } from './error-utils';

export type ApprovalControllerContext = {
  api: {
    resolveCodexApproval: (
      sessionId: string,
      requestId: string,
      decision: ApprovalDecision,
    ) => Promise<void>;
  };
  getDesktop: () => boolean;
  getPendingApprovals: () => ApprovalRequest[];
  setPendingApprovals: (value: ApprovalRequest[]) => void;
  setBusy: (value: boolean) => void;
  setErrorMessage: (value: string | null) => void;
  setNotice: (value: string) => void;
};

/** Coordinates approval resolution without depending on Svelte state or UI. */
export function createApprovalController(context: ApprovalControllerContext) {
  async function resolveApproval(
    approval: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；审批操作需要在 Tauri 桌面模式中执行。');
      return;
    }
    if (!approval.availableDecisions.includes(decision)) return;

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      await context.api.resolveCodexApproval(
        approval.sessionId,
        approval.requestId,
        decision,
      );
      context.setPendingApprovals(
        context.getPendingApprovals().filter(
          (item) =>
            item.sessionId !== approval.sessionId || item.requestId !== approval.requestId,
        ),
      );
      context.setNotice(decision === 'accept' ? '已允许本次操作。' : '已拒绝本次操作。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      context.setBusy(false);
    }
  }

  return { resolveApproval };
}
