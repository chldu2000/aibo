<script lang="ts">
  import type { UiModelMatrixProps } from '../../contract';
  import Icon from './Icon.svelte';

  let {
    columns,
    rows,
    defaultLabel,
    defaultTitle,
    disabled,
    onSelect,
  }: UiModelMatrixProps = $props();

  function effortIntensity(index: number, count: number): number {
    return Math.max(1, Math.ceil(((index + 1) / Math.max(count, 1)) * 4));
  }
</script>

<div class="shadcn-model-matrix-wrap">
  <table class="shadcn-model-matrix" aria-label="模型与推理强度">
    <thead>
      <tr>
        <th scope="col">模型</th>
        <th scope="col" title={defaultTitle}>{defaultLabel}</th>
        {#each columns as column, columnIndex (column.id)}
          <th scope="col" data-intensity={effortIntensity(columnIndex, columns.length)} title={column.description ?? column.label}>{column.label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.reference)}
        <tr class:active-row={row.active}>
          <th scope="row" title={`${row.label} · ${row.reference}`}>
            <span>{row.label}</span>
            {#if row.isDefault}<small>默认</small>{/if}
          </th>
          <td>
            <button
              type="button"
              class:active={row.defaultActive}
              aria-label={`${row.label}，${defaultLabel}`}
              aria-pressed={row.defaultActive}
              disabled={disabled}
              onclick={() => onSelect(row.reference, null)}
            >{#if row.defaultActive}<Icon name="check" size={13} />{:else}<span aria-hidden="true">—</span>{/if}</button>
          </td>
          {#each row.cells as cell, cellIndex (cell.id)}
            <td>
              <button
                type="button"
                class:active={cell.active}
                data-intensity={effortIntensity(cellIndex, columns.length)}
                aria-label={`${row.label}，${cell.label}`}
                aria-pressed={cell.active}
                disabled={!cell.available || disabled}
                title={cell.available ? `${row.label} · ${cell.label}` : `${row.label} 不支持 ${cell.label}`}
                onclick={() => onSelect(row.reference, cell.id)}
              >
                <span class="effort-aura" aria-hidden="true"></span>
                <span class="effort-spark effort-spark-a" aria-hidden="true"></span>
                <span class="effort-spark effort-spark-b" aria-hidden="true"></span>
                <span class="effort-mark">{#if cell.active}<Icon name="check" size={13} />{:else}<span aria-hidden="true">{cell.available ? '○' : '—'}</span>{/if}</span>
              </button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .shadcn-model-matrix-wrap {
    max-height: 250px;
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .shadcn-model-matrix {
    width: 100%;
    min-width: max-content;
    border-collapse: separate;
    border-spacing: 0;
    color: var(--muted-foreground);
    font-size: 10px;
  }

  .shadcn-model-matrix th,
  .shadcn-model-matrix td {
    height: 32px;
    border-bottom: 1px solid var(--border);
  }

  .shadcn-model-matrix tr:last-child th,
  .shadcn-model-matrix tr:last-child td {
    border-bottom: 0;
  }

  .shadcn-model-matrix thead th {
    position: sticky;
    z-index: 1;
    top: 0;
    min-width: 52px;
    padding: 0 7px;
    color: var(--muted-foreground);
    background: var(--card);
    font-size: 9px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
  }

  .shadcn-model-matrix thead th[data-intensity="3"] { color: color-mix(in srgb, var(--muted-foreground) 70%, var(--primary)); }
  .shadcn-model-matrix thead th[data-intensity="4"] { color: var(--primary); }

  .shadcn-model-matrix thead th:first-child {
    z-index: 2;
    left: 0;
    min-width: 136px;
    text-align: left;
  }

  .shadcn-model-matrix tbody th {
    position: sticky;
    z-index: 1;
    left: 0;
    max-width: 156px;
    padding: 0 8px;
    overflow: hidden;
    color: var(--muted-foreground);
    background: var(--card);
    font-weight: 500;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shadcn-model-matrix tbody th span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shadcn-model-matrix tbody th small {
    margin-left: 4px;
    color: var(--muted-foreground);
    font-size: 8px;
  }

  .shadcn-model-matrix tr.active-row th {
    color: var(--foreground);
    background: var(--accent);
  }

  .shadcn-model-matrix td {
    width: 52px;
    padding: 2px;
    text-align: center;
  }

  .shadcn-model-matrix td button {
    position: relative;
    display: inline-flex;
    width: 100%;
    height: 26px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    padding: 0;
    color: var(--muted-foreground);
    background: transparent;
    font-size: 13px;
    text-align: center;
    isolation: isolate;
    transition: color 160ms ease, background-color 160ms ease, box-shadow 220ms ease, transform 160ms ease;
  }

  .effort-mark { position: relative; z-index: 2; display: inline-flex; }
  .effort-aura, .effort-spark { position: absolute; pointer-events: none; }
  .effort-aura { z-index: 0; inset: 3px; border-radius: inherit; opacity: 0; }
  .effort-spark { z-index: 1; width: 3px; height: 3px; border-radius: 999px; background: var(--primary-foreground); opacity: 0; }
  .effort-spark-a { top: 4px; right: 7px; }
  .effort-spark-b { bottom: 4px; left: 7px; }

  .shadcn-model-matrix td button:hover:not(:disabled),
  .shadcn-model-matrix td button:focus-visible {
    color: var(--foreground);
    background: var(--accent);
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }

  .shadcn-model-matrix td button.active {
    color: var(--primary-foreground);
    background: var(--primary);
  }

  .shadcn-model-matrix td button.active[data-intensity="2"] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 35%, transparent), 0 0 8px color-mix(in srgb, var(--primary) 28%, transparent); }
  .shadcn-model-matrix td button.active[data-intensity="3"] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 48%, transparent), 0 0 13px color-mix(in srgb, var(--primary) 42%, transparent); transform: translateY(-1px); }
  .shadcn-model-matrix td button.active[data-intensity="4"] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 65%, transparent), 0 0 18px color-mix(in srgb, var(--primary) 58%, transparent); transform: translateY(-1px) scale(1.03); }

  @media (prefers-reduced-motion: no-preference) {
    .shadcn-model-matrix td button.active[data-intensity="3"] .effort-aura,
    .shadcn-model-matrix td button.active[data-intensity="4"] .effort-aura { background: linear-gradient(110deg, transparent 25%, color-mix(in srgb, var(--primary-foreground) 42%, transparent) 48%, transparent 70%); opacity: .7; animation: shadcn-effort-sheen 1.8s ease-in-out infinite; }
    .shadcn-model-matrix td button.active[data-intensity="4"] { animation: shadcn-effort-pulse 2.2s ease-in-out infinite; }
    .shadcn-model-matrix td button.active[data-intensity="4"] .effort-spark { animation: shadcn-effort-spark 1.4s ease-in-out infinite; }
    .shadcn-model-matrix td button.active[data-intensity="4"] .effort-spark-b { animation-delay: -.7s; }
  }

  @keyframes shadcn-effort-sheen { 0%, 30% { transform: translateX(-45%); opacity: 0; } 55% { opacity: .8; } 80%, 100% { transform: translateX(45%); opacity: 0; } }
  @keyframes shadcn-effort-pulse { 0%, 100% { filter: saturate(1); } 50% { filter: saturate(1.3) brightness(1.08); } }
  @keyframes shadcn-effort-spark { 0%, 100% { opacity: 0; transform: scale(.4); } 45% { opacity: .95; transform: scale(1.35); } 70% { opacity: 0; transform: translateY(-4px) scale(.7); } }

  .shadcn-model-matrix td button:disabled {
    cursor: not-allowed;
    opacity: .35;
  }
</style>
