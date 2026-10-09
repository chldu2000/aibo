<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import { formatDateTime, formatNumber } from '../../../../packages/i18n/index.js';
  import type { UsageValues } from '$lib/app/session-usage';
  import { Separator } from '$lib/ui-kit';

  let { desktop, workspaceLabel, themeLabel, usage }: {
    desktop: boolean;
    workspaceLabel: string | null;
    themeLabel: string;
    usage: UsageValues | null;
  } = $props();

  function compactNumber(value: number): string {
    return formatNumber($locale, value, { notation: 'compact', maximumFractionDigits: 1 });
  }

  function limitLabel(limit: UsageValues['limits'][number]): string {
    if (limit.label) return limit.label;
    if (limit.windowMinutes && limit.windowMinutes % 1440 === 0) return $t('time.days', { count: limit.windowMinutes / 1440 });
    if (limit.windowMinutes && limit.windowMinutes % 60 === 0) return $t('time.hours', { count: limit.windowMinutes / 60 });
    return limit.windowMinutes ? $t('time.minutes', { count: limit.windowMinutes }) : $t('usage.plan');
  }

  const items = $derived.by(() => {
    const result: { id: string; label: string; detail?: string }[] = [];
    if (!usage) return result;
    if (usage.contextUsed !== null) {
      const hasLimit = usage.contextLimit !== null && usage.contextLimit > 0;
      const amount = hasLimit
        ? `${Math.min(100, Math.max(0, Math.round(usage.contextUsed / usage.contextLimit! * 100)))}%`
        : compactNumber(usage.contextUsed);
      result.push({
        id: 'context', label: $t('usage.context', { amount, estimated: usage.contextEstimated ? $t('usage.estimated') : '' }),
        detail: `${usage.contextUsed}${hasLimit ? ` / ${usage.contextLimit}` : ''} tokens${usage.contextEstimated ? $t('usage.estimatedDetail') : ''}`,
      });
    }
    if (usage.total !== null) result.push({ id: 'total', label: `Token ${compactNumber(usage.total)}`, detail: $t('usage.tokenDetail', { total: usage.total, input: usage.input ?? '—', output: usage.output ?? '—' }) });
    if (usage.plan) result.push({ id: 'plan', label: usage.plan.toUpperCase() });
    for (const limit of usage.limits) {
      result.push({
        id: `limit:${limit.id}`, label: `${limitLabel(limit)}${limit.usedPercent === null ? $t('usage.unknownQuota') : $t('usage.remaining', { percent: Math.max(0, 100 - Math.round(limit.usedPercent)) })}${limit.observedAt !== undefined ? $t('usage.observed') : ''}`,
        detail: limit.usedPercent === null ? $t('usage.awaitingReset') : limit.resetsAt !== null ? $t('usage.resetsAt', { time: formatDateTime($locale, limit.resetsAt * 1000, { dateStyle: 'medium', timeStyle: 'short' }) }) : $t('usage.unknownReset'),
      });
    }
    if (usage.credits?.unlimited) result.push({ id: 'credits', label: $t('usage.unlimitedCredits') });
    else if (usage.credits?.balance) result.push({ id: 'credits', label: `Credits ${usage.credits.balance}` });
    return result;
  });
</script>

<footer class="workbench-status" class:has-usage={items.length > 0} aria-label={$t('workbench.status')}>
  <span class="workbench-status-environment">{desktop ? $t('workbench.local') : $t('workbench.preview')}</span>
  <span class="workbench-status-workspace" title={workspaceLabel ?? $t('workspace.none')}>{workspaceLabel ?? $t('workspace.none')}</span>
  {#if items.length > 0}
    <Separator orientation="vertical" class="workbench-status-divider" />
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll overflowing usage text.) -->
    <div class="workbench-status-usage" role="group" aria-label={$t('usage.accessibility')} tabindex="0">
      {#each items as item (item.id)}
        <span data-usage={item.id} title={item.detail}>{item.label}</span>
      {/each}
    </div>
  {/if}
  <span class="workbench-status-theme">{themeLabel}</span>
</footer>
