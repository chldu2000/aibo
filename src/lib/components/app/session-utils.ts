import type { SessionState } from '$lib/types';
export { isSessionRunning } from '$lib/app/session-state';

type SessionStateView = {
  state: SessionState;
  archived?: boolean;
};

export function sessionStateLabel(session: SessionStateView): string {
  if (session.archived) return '已归档';
  switch (session.state) {
    case 'waiting_approval':
      return '待审批';
    case 'running':
      return '运行中';
    case 'interrupted':
      return '已中断';
    case 'failed':
      return '失败';
    case 'closed':
      return '已关闭';
    case 'starting':
      return '启动中';
    case 'created':
      return '新建';
    default:
      return '空闲';
  }
}

export function sessionStatusTone(session: SessionStateView): string {
  if (session.archived || session.state === 'closed') return 'muted';
  if (session.state === 'running' || session.state === 'starting') return 'running';
  if (session.state === 'waiting_approval') return 'attention';
  if (session.state === 'failed' || session.state === 'interrupted') return 'danger';
  return 'idle';
}

export function relativeTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return '刚刚';
  if (elapsedSeconds < 60 * 60) return `${Math.floor(elapsedSeconds / 60)}分`;
  if (elapsedSeconds < 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (60 * 60))}时`;
  if (elapsedSeconds < 30 * 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (24 * 60 * 60))}天`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp);
}
