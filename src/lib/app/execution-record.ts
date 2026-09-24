type ExecutionRecord = {
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Timestamps describe the observed record lifetime, not provider-reported CPU time. */
export function executionTiming(item: ExecutionRecord) {
  const start = Date.parse(item.createdAt ?? '');
  const end = Date.parse(item.updatedAt ?? '');
  const finished = ['completed', 'failed', 'interrupted'].includes(item.status);
  const elapsed = finished && Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
  return {
    dateTime: Number.isFinite(start) ? item.createdAt : undefined,
    timeLabel: Number.isFinite(start) ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start) : '—',
    durationLabel: elapsed === null ? '—' : elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`,
    durationTitle: elapsed === null ? '没有可用的完整起止时间' : '首次记录至最后更新的间隔',
  };
}
