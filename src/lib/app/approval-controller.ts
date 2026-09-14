import type { ApprovalDecision, ApprovalRequest } from '$lib/types';
import { toErrorMessage } from './error-utils';

export type ApprovalControllerContext = {
  api: {
    resolveAgentApproval: (
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
  const resolving = new Set<string>();
  const sameRequest = (left: ApprovalRequest, right: ApprovalRequest) =>
    left.sessionId === right.sessionId && left.requestId === right.requestId
    && left.turnId === right.turnId && left.kind === right.kind
    && left.command === right.command && left.cwd === right.cwd;
  async function resolveApproval(
    approval: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；审批操作需要在 Tauri 桌面模式中执行。');
      return;
    }
    const key = JSON.stringify([approval.sessionId, approval.requestId]);
    const current = context.getPendingApprovals().find(item =>
      item.sessionId === approval.sessionId && item.requestId === approval.requestId);
    // A detached card cannot approve a replaced request or change its advertised choices.
    if (!current || resolving.has(key) || !current.availableDecisions.includes(decision)) return;
    if (!sameRequest(current, approval)) return;
    resolving.add(key);

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      await context.api.resolveAgentApproval(approval.sessionId, approval.requestId, decision);
      context.setPendingApprovals(
        context.getPendingApprovals().filter(
          (item) =>
            !sameRequest(item, current),
        ),
      );
      context.setNotice(decision === 'accept' ? '已允许本次操作。' : '已拒绝本次操作。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      resolving.delete(key);
      context.setBusy(resolving.size > 0);
    }
  }

  return { resolveApproval };
}
