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

<div class="ak-model-matrix-wrap">
  {#if fastTier}
    <div class="ak-model-matrix-tools">
      <button type="button" class:active={fastTier.active} aria-label={fastTier.label} aria-pressed={fastTier.active}
        disabled={disabled} title={fastTier.description ?? fastTier.label}
        onclick={() => onSelectServiceTier(fastTier.active ? 'default' : fastTier.id)}><Icon name="bolt" size={15} /><span>{fastTier.label}</span></button>
    </div>
  {/if}
  <table class="ak-model-matrix" aria-label="模型与推理强度">
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
  .ak-model-matrix-wrap { max-height: 320px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--aibo-border); border-radius: var(--ak-radius-subtle); }
  .ak-model-matrix-tools { display: flex; padding: var(--ak-space-2); border-bottom: 1px solid var(--aibo-border); }
  .ak-model-matrix-tools button { display: inline-flex; align-items: center; gap: var(--ak-space-2); min-height: var(--ak-density-control-height); padding-inline: var(--ak-space-3); border: 1px solid var(--aibo-border); color: var(--aibo-text); background: transparent; font-size: var(--ak-type-label-size); }
  .ak-model-matrix { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; color: var(--aibo-text); font-size: var(--ak-type-data-size); }
  th, td { height: var(--ak-density-control-height); border-bottom: 1px solid var(--aibo-border); }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  thead th { position: sticky; z-index: 1; top: 0; min-width: 52px; padding-inline: var(--ak-space-2); background: var(--aibo-surface); font-weight: 500; text-align: center; white-space: nowrap; }
  thead th:first-child { z-index: 2; left: 0; min-width: 136px; text-align: left; }
  tbody th { position: sticky; z-index: 1; left: 0; max-width: 200px; padding-inline: var(--ak-space-2); background: var(--aibo-surface); font-weight: 500; text-align: left; overflow-wrap: anywhere; }
  tbody th small { display: block; color: var(--aibo-muted); font-size: var(--ak-type-label-size); }
  tr.active-row th { background: var(--aibo-accent-soft); }
  td { min-width: 52px; padding: 2px; text-align: center; }
  td button { display: inline-flex; width: 100%; min-height: var(--ak-density-control-height); align-items: center; justify-content: center; border: 0; padding: 0; color: var(--aibo-text); background: transparent; font: inherit; }
  button:hover:not(:disabled) { background: var(--aibo-surface-hover); box-shadow: inset 0 -2px var(--aibo-border); }
  button:focus-visible { outline: var(--ak-focus-width) solid var(--aibo-focus); outline-offset: -2px; }
  td button.active, .ak-model-matrix-tools button.active { color: var(--primary-foreground); background: var(--primary); }
  button:disabled { cursor: not-allowed; opacity: .5; }
</style>
