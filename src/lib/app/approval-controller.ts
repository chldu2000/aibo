import type { ApprovalDecision, ApprovalRequest } from '$lib/types';
import { toErrorMessage } from './error-utils';

export type ApprovalControllerContext = {
  api: {
    resolveCodexApproval: (
      sessionId: string,
      requestId: string,
      decision: ApprovalDecision,
    ) => Promise<void>;
    resolvePiApproval: (
      sessionId: string,
      requestId: string,
      decision: ApprovalDecision,
    ) => Promise<void>;
  };
  getDesktop: () => boolean;
  getSessionAgent: (sessionId: string) => 'codex' | 'pi' | null;
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
      // The approval kind comes from adapter payload data and may be absent
      // on an event restored from an older stream. The session agent is the
      // authoritative boundary, so never send a Pi approval to Codex merely
      // because its kind was normalized to the generic fallback.
      const isPiApproval =
        context.getSessionAgent(approval.sessionId) === 'pi' || approval.kind === 'pi_tool';
      const resolve = isPiApproval
        ? context.api.resolvePiApproval
        : context.api.resolveCodexApproval;
      await resolve(approval.sessionId, approval.requestId, decision);
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
