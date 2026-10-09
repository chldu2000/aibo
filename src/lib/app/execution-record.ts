import { formatDateTime, translate } from '../../../packages/i18n/index.js';
import type { Locale } from '../../../packages/i18n/index.js';

type ExecutionRecord = {
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Timestamps describe the observed record lifetime, not provider-reported CPU time. */
export function executionTiming(item: ExecutionRecord, locale: Locale = 'zh-CN') {
  const start = Date.parse(item.createdAt ?? '');
  const end = Date.parse(item.updatedAt ?? '');
  const finished = ['completed', 'failed', 'interrupted'].includes(item.status);
  const elapsed = finished && Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
  return {
    dateTime: Number.isFinite(start) ? item.createdAt : undefined,
    timeLabel: formatDateTime(locale, start, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    durationLabel: elapsed === null ? '—' : elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`,
    durationTitle: translate(locale, elapsed === null ? 'execution.missingTime' : 'execution.durationDescription'),
  };
}
