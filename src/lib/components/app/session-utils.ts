import { translate, formatDateTime } from '../../../../packages/i18n/index.js';
import type { Locale, MessageKey } from '../../../../packages/i18n/index.js';
import type { SessionState } from '$lib/types';
export { isSessionRunning } from '$lib/app/session-state';

type SessionStateView = {
  state: SessionState;
  archived?: boolean;
};

export function sessionStateLabel(session: SessionStateView, locale: Locale = 'zh-CN'): string {
  if (session.archived) return translate(locale, 'session.status.archived');
  const state = ['waiting_approval', 'waiting_user', 'compacting', 'running', 'interrupted', 'failed', 'closed', 'starting', 'created'].includes(session.state) ? session.state : 'idle';
  return translate(locale, `session.status.${state}` as MessageKey);
}

export function sessionStatusTone(session: SessionStateView): 'idle' | 'running' | 'attention' | 'danger' | 'muted' {
  if (session.archived || session.state === 'closed') return 'muted';
  if (session.state === 'running' || session.state === 'starting' || session.state === 'compacting') return 'running';
  if (session.state === 'waiting_approval' || session.state === 'waiting_user') return 'attention';
  if (session.state === 'failed' || session.state === 'interrupted') return 'danger';
  return 'idle';
}

export function relativeTimeLabel(value: string, locale: Locale = 'zh-CN'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return translate(locale, 'time.justNow');
  if (elapsedSeconds < 60 * 60) return translate(locale, 'time.minutes', { count: Math.floor(elapsedSeconds / 60) });
  if (elapsedSeconds < 24 * 60 * 60) return translate(locale, 'time.hours', { count: Math.floor(elapsedSeconds / (60 * 60)) });
  if (elapsedSeconds < 30 * 24 * 60 * 60) return translate(locale, 'time.days', { count: Math.floor(elapsedSeconds / (24 * 60 * 60)) });
  return formatDateTime(locale, timestamp, { month: 'numeric', day: 'numeric' });
}

/** Git timestamps include direction without inspecting translated text. */
export function relativeDateLabel(value: string, locale: Locale = 'zh-CN', now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.floor((timestamp - now) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return translate(locale, 'time.justNow');
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  if (magnitude < 3600) return formatter.format(Math.trunc(seconds / 60), 'minute');
  if (magnitude < 86400) return formatter.format(Math.trunc(seconds / 3600), 'hour');
  if (magnitude < 30 * 86400) return formatter.format(Math.trunc(seconds / 86400), 'day');
  return formatDateTime(locale, timestamp, { month: 'numeric', day: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
