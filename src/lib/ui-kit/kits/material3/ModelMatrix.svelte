<script lang="ts">
  import type { UiModelMatrixProps } from '../../contract';
  import Icon from './Icon.svelte';

  let {
    columns,
    rows,
    defaultLabel,
    defaultTitle,
    fastTier,
    disabled,
    onSelect,
    onSelectServiceTier,
  }: UiModelMatrixProps = $props();

  function effortIntensity(index: number, count: number): number {
    return Math.max(1, Math.ceil(((index + 1) / Math.max(count, 1)) * 4));
  }
</script>

<div class="m3-model-matrix-wrap">
  {#if fastTier}
    <div class="m3-model-matrix-tools">
      <button type="button" class:active={fastTier.active} aria-label={fastTier.label} aria-pressed={fastTier.active}
        disabled={disabled} title={fastTier.description ?? fastTier.label}
        onclick={() => onSelectServiceTier(fastTier.active ? 'default' : fastTier.id)}><Icon name="bolt" size={17} /><span>{fastTier.label}</span></button>
    </div>
  {/if}
  <table class="m3-model-matrix" aria-label="模型与推理强度">
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
            >{#if row.defaultActive}<Icon name="check" size={12} />{:else}<span aria-hidden="true">—</span>{/if}</button>
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
                <span class="effort-orbit" aria-hidden="true"></span>
                <span class="effort-spark effort-spark-a" aria-hidden="true"></span>
                <span class="effort-spark effort-spark-b" aria-hidden="true"></span>
                <span class="effort-mark">{#if cell.active}<Icon name="check" size={12} />{:else}<span aria-hidden="true">{cell.available ? '○' : '—'}</span>{/if}</span>
              </button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .m3-model-matrix-tools { display: flex; padding: 8px; border-bottom: 1px solid var(--m3c-outline-variant); background: var(--m3c-surface-container); }
  .m3-model-matrix-tools button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--m3c-outline); border-radius: var(--m3-shape-small); padding: 5px 9px; color: var(--m3c-on-surface-variant); background: transparent; font: inherit; }
  .m3-model-matrix-tools button.active { border-color: var(--m3c-primary); color: var(--m3c-primary); background: var(--m3c-primary-container); }
  .m3-model-matrix-wrap {
    max-height: 224px;
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background: var(--m3c-surface-container-low);
  }

  .m3-model-matrix {
    width: 100%;
    min-width: max-content;
    border-collapse: separate;
    border-spacing: 0;
    color: var(--m3c-on-surface-variant);
    font-size: var(--m3-body-small-size);
    line-height: var(--m3-body-small-line-height);
    letter-spacing: var(--m3-body-small-tracking);
  }

  .m3-model-matrix th,
  .m3-model-matrix td {
    height: 40px;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .m3-model-matrix tr:last-child th,
  .m3-model-matrix tr:last-child td {
    border-bottom: 0;
  }

  .m3-model-matrix thead th {
    position: sticky;
    z-index: 1;
    top: 0;
    min-width: 52px;
    padding: 0 6px;
    color: var(--m3c-on-surface-variant);
    background: var(--m3c-surface-container);
    font-size: var(--m3-label-small-size);
    font-weight: var(--m3-label-small-weight);
    line-height: var(--m3-label-small-line-height);
    letter-spacing: var(--m3-label-small-tracking);
    text-align: center;
    white-space: nowrap;
  }

  .m3-model-matrix thead th[data-intensity="3"] { color: color-mix(in srgb, var(--m3c-on-surface-variant) 68%, var(--m3c-primary)); }
  .m3-model-matrix thead th[data-intensity="4"] { color: var(--m3c-primary); }

  .m3-model-matrix thead th:first-child {
    z-index: 2;
    left: 0;
    min-width: 132px;
    text-align: left;
  }

  .m3-model-matrix tbody th {
    position: sticky;
    z-index: 1;
    left: 0;
    max-width: 152px;
    padding: 0 8px;
    overflow: hidden;
    color: var(--m3c-on-surface-variant);
    background: var(--m3c-surface-container-low);
    font-weight: 500;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m3-model-matrix tbody th span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .m3-model-matrix tbody th small {
    margin-left: 5px;
    color: var(--m3c-on-surface-variant);
    font-size: var(--m3-label-small-size);
  }

  .m3-model-matrix tr.active-row th {
    color: var(--m3c-on-surface);
    background: var(--m3c-primary-container);
  }

  .m3-model-matrix td {
    width: 52px;
    padding: 2px;
    text-align: center;
  }

  .m3-model-matrix td button {
    position: relative;
    display: inline-flex;
    width: 100%;
    height: 32px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--m3-shape-small);
    padding: 0;
    color: var(--m3c-on-surface-variant);
    background: transparent;
    font-size: var(--m3-body-medium-size);
    line-height: var(--m3-body-medium-line-height);
    text-align: center;
    transition: background-color var(--m3-easing-fast), color var(--m3-easing-fast);
    isolation: isolate;
  }

  .effort-mark { position: relative; z-index: 2; display: inline-flex; }
  .effort-orbit, .effort-spark { position: absolute; pointer-events: none; }
  .effort-orbit { z-index: 0; inset: 3px; border: 1px solid transparent; border-radius: inherit; opacity: 0; }
  .effort-spark { z-index: 1; width: 3px; height: 3px; border-radius: 50%; background: var(--m3c-on-primary-container); opacity: 0; }
  .effort-spark-a { top: 5px; right: 8px; }
  .effort-spark-b { bottom: 5px; left: 8px; }

  .m3-model-matrix td button:hover:not(:disabled),
  .m3-model-matrix td button:focus-visible {
    color: var(--m3c-on-surface);
    background: var(--m3c-surface-container-high);
    outline: 2px solid var(--m3c-primary);
    outline-offset: -2px;
  }

  .m3-model-matrix td button.active {
    color: var(--m3c-on-primary-container);
    background: var(--m3c-primary-container);
  }

  .m3-model-matrix td button.active[data-intensity="2"] { box-shadow: 0 1px 5px color-mix(in srgb, var(--m3c-primary) 24%, transparent); }
  .m3-model-matrix td button.active[data-intensity="3"] { box-shadow: 0 2px 9px color-mix(in srgb, var(--m3c-primary) 36%, transparent); transform: translateY(-1px); }
  .m3-model-matrix td button.active[data-intensity="4"] { box-shadow: 0 3px 14px color-mix(in srgb, var(--m3c-primary) 50%, transparent); transform: translateY(-1px) scale(1.03); }

  @media (prefers-reduced-motion: no-preference) {
    .m3-model-matrix td button.active[data-intensity="3"] .effort-orbit,
    .m3-model-matrix td button.active[data-intensity="4"] .effort-orbit { border-color: color-mix(in srgb, var(--m3c-primary) 42%, transparent); opacity: .8; animation: m3-effort-orbit 2.4s cubic-bezier(.2, 0, 0, 1) infinite; }
    .m3-model-matrix td button.active[data-intensity="4"] { animation: m3-effort-bloom 2s cubic-bezier(.2, 0, 0, 1) infinite; }
    .m3-model-matrix td button.active[data-intensity="4"] .effort-spark { animation: m3-effort-spark 1.5s ease-in-out infinite; }
    .m3-model-matrix td button.active[data-intensity="4"] .effort-spark-b { animation-delay: -.75s; }
  }

  @keyframes m3-effort-orbit { 0% { opacity: 0; transform: scale(.7); } 35% { opacity: .85; } 75%, 100% { opacity: 0; transform: scale(1.18); } }
  @keyframes m3-effort-bloom { 0%, 100% { filter: saturate(1); } 50% { filter: saturate(1.25) brightness(1.06); } }
  @keyframes m3-effort-spark { 0%, 100% { opacity: 0; transform: scale(.4); } 45% { opacity: 1; transform: scale(1.45); } 70% { opacity: 0; transform: translateY(-4px) scale(.7); } }

  .m3-model-matrix td button:disabled {
    cursor: not-allowed;
    opacity: .38;
  }
</style>
