import type { ApprovalChoice, ApprovalRequest } from '$lib/types';
import { toErrorMessage } from './error-utils';

export type ApprovalControllerContext = {
  api: {
    resolveAgentApproval: (
      sessionId: string,
      requestId: string,
      choice: ApprovalChoice,
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
    && left.command === right.command && left.cwd === right.cwd
    && JSON.stringify(left.options) === JSON.stringify(right.options);
  async function resolveApproval(
    approval: ApprovalRequest,
    choice: ApprovalChoice,
  ): Promise<void> {
    if (!context.getDesktop()) {
      context.setNotice('当前是 Web 预览；审批操作需要在 Tauri 桌面模式中执行。');
      return;
    }
    const key = JSON.stringify([approval.sessionId, approval.requestId]);
    const current = context.getPendingApprovals().find(item =>
      item.sessionId === approval.sessionId && item.requestId === approval.requestId);
    // A detached card cannot approve a replaced request or change its advertised choices.
    const option = typeof choice === 'object' ? current?.options.find(item => item.id === choice.optionId) : undefined;
    const offered = typeof choice === 'object' ? option !== undefined : current?.availableDecisions.includes(choice) === true;
    if (!current || resolving.has(key) || !offered) return;
    if (!sameRequest(current, approval)) return;
    resolving.add(key);

    context.setBusy(true);
    context.setErrorMessage(null);
    try {
      await context.api.resolveAgentApproval(approval.sessionId, approval.requestId, choice);
      context.setPendingApprovals(
        context.getPendingApprovals().filter(
          (item) =>
            !sameRequest(item, current),
        ),
      );
      const allowed = option ? option.kind === 'allow' : choice === 'accept';
      context.setNotice(option?.label ? `已选择：${option.label}。` : allowed ? '已允许本次操作。' : '已拒绝本次操作。');
    } catch (error) {
      context.setErrorMessage(toErrorMessage(error));
    } finally {
      resolving.delete(key);
      context.setBusy(resolving.size > 0);
    }
  }

  return { resolveApproval };
}
