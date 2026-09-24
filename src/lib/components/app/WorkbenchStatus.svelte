<script lang="ts">
  import type { UsageValues } from '$lib/app/session-usage';
  import { Separator } from '$lib/ui-kit';

  let { desktop, workspaceLabel, themeLabel, usage }: {
    desktop: boolean;
    workspaceLabel: string | null;
    themeLabel: string;
    usage: UsageValues | null;
  } = $props();

  function compactNumber(value: number): string {
    return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function limitLabel(limit: UsageValues['limits'][number]): string {
    if (limit.label) return limit.label;
    if (limit.windowMinutes && limit.windowMinutes % 1440 === 0) return `${limit.windowMinutes / 1440} 天`;
    if (limit.windowMinutes && limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60} 小时`;
    return limit.windowMinutes ? `${limit.windowMinutes} 分钟` : '套餐';
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
        id: 'context', label: `上下文 ${amount}${usage.contextEstimated ? ' · 估算' : ''}`,
        detail: `${usage.contextUsed}${hasLimit ? ` / ${usage.contextLimit}` : ''} tokens${usage.contextEstimated ? '（估算）' : ''}`,
      });
    }
    if (usage.total !== null) result.push({ id: 'total', label: `Token ${compactNumber(usage.total)}`, detail: `累计 ${usage.total} · 输入 ${usage.input ?? '—'} · 输出 ${usage.output ?? '—'}` });
    if (usage.plan) result.push({ id: 'plan', label: usage.plan.toUpperCase() });
    for (const limit of usage.limits) {
      result.push({
        id: `limit:${limit.id}`, label: `${limitLabel(limit)}剩余 ${Math.max(0, 100 - Math.round(limit.usedPercent))}%`,
        detail: limit.resetsAt !== null ? `重置于 ${new Date(limit.resetsAt * 1000).toLocaleString()}` : undefined,
      });
    }
    if (usage.credits?.unlimited) result.push({ id: 'credits', label: 'Credits 不限量' });
    else if (usage.credits?.balance) result.push({ id: 'credits', label: `Credits ${usage.credits.balance}` });
    return result;
  });
</script>

<footer class="workbench-status" class:has-usage={items.length > 0} aria-label="工作台状态">
  <span class="workbench-status-environment">{desktop ? '本地工作区' : '浏览器预览'}</span>
  <span class="workbench-status-workspace" title={workspaceLabel ?? '未选择工作区'}>{workspaceLabel ?? '未选择工作区'}</span>
  {#if items.length > 0}
    <Separator orientation="vertical" class="workbench-status-divider" />
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll overflowing usage text.) -->
    <div class="workbench-status-usage" role="group" aria-label="会话用量与套餐余量" tabindex="0">
      {#each items as item (item.id)}
        <span data-usage={item.id} title={item.detail}>{item.label}</span>
      {/each}
    </div>
  {/if}
  <span class="workbench-status-theme">{themeLabel}</span>
</footer>
