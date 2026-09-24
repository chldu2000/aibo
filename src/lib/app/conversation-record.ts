type RecordTiming = { status: string; createdAt?: string; updatedAt?: string };

/** Sum observed lifetimes only when every record has a complete interval. */
export function toolGroupDuration(items: readonly RecordTiming[]): string | null {
  if (!items.length) return null;
  let total = 0;
  for (const item of items) {
    const start = Date.parse(item.createdAt ?? '');
    const end = Date.parse(item.updatedAt ?? '');
    if (!['completed', 'failed', 'interrupted'].includes(item.status)
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    total += end - start;
  }
  return `${(total / 1000).toFixed(1)}s`;
}

/** A preview of the supplied content, never a guessed provider-specific target. */
export function toolContentPreview(content: string): string {
  return content.split('\n').map(line => line.trim()).find(Boolean) ?? '';
}
