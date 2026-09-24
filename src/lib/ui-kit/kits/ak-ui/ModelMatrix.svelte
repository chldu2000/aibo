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
            >{#if row.defaultActive}<Icon name="check" size={16} />{:else}<span aria-hidden="true">—</span>{/if}</button>
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
                {#if cell.active}
                  <span class="effort-selection" aria-hidden="true">
                    <span class="effort-sweep"></span>
                    <span class="effort-charge">
                      {#each [1, 2, 3, 4] as tick}
                        <span class="effort-charge-tick" class:lit={tick <= effortIntensity(cellIndex, columns.length)} style={`--effort-step: ${tick - 1}`}></span>
                      {/each}
                    </span>
                  </span>
                {/if}
                <span class="effort-mark" aria-hidden="true">
                  {#if cell.active}
                    <Icon name="check" size={16} />
                  {:else if cell.available}
                    <span class="effort-ticks">
                      {#each [1, 2, 3, 4] as tick}
                        <span class="effort-tick" class:filled={tick <= effortIntensity(cellIndex, columns.length)}></span>
                      {/each}
                    </span>
                  {:else}
                    <span>—</span>
                  {/if}
                </span>
              </button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .ak-model-matrix-wrap { max-height: 320px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--aibo-border); border-radius: 0; background: var(--ak-surface-panel); }
  .ak-model-matrix-tools { position: sticky; left: 0; z-index: 3; display: flex; padding: var(--ak-space-2); border-bottom: 1px solid var(--aibo-border); background: var(--ak-surface-muted); }
  .ak-model-matrix-tools button { display: inline-flex; align-items: center; gap: var(--ak-space-2); min-height: var(--ak-density-control-height); padding-inline: var(--ak-space-3); border: 1px solid var(--aibo-border); border-radius: 0; color: var(--aibo-text); background: transparent; font-size: var(--aibo-type-ui); }
  .ak-model-matrix { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; color: var(--aibo-text); font-size: var(--aibo-type-ui); }
  th, td { height: var(--ak-density-control-height); border-bottom: 1px solid var(--aibo-border); }
  tr:last-child th, tr:last-child td { border-bottom: 0; }
  thead th { position: sticky; z-index: 1; top: 0; min-width: 52px; padding-inline: var(--ak-space-2); background: var(--ak-surface-muted); color: var(--aibo-muted); font-weight: 500; text-align: center; white-space: nowrap; }
  thead th:first-child { z-index: 2; left: 0; min-width: 136px; text-align: left; }
  tbody th { position: sticky; z-index: 1; left: 0; max-width: 200px; padding-inline: var(--ak-space-3); background: var(--ak-surface-panel); font-weight: 500; text-align: left; overflow-wrap: anywhere; }
  tbody th small { display: block; color: var(--aibo-muted); font-size: var(--ak-type-label-size); }
  tr.active-row th { color: var(--aibo-info-text); background: var(--aibo-accent-soft); box-shadow: inset var(--ak-line-strong) 0 var(--aibo-focus); }
  td { min-width: 52px; padding: 0; text-align: center; }
  td button { position: relative; isolation: isolate; display: inline-flex; width: 100%; min-height: var(--ak-density-control-height); align-items: center; justify-content: center; border: 0; border-radius: 0; padding: 0; color: var(--aibo-muted); background: transparent; font: inherit; }
  button { transition: background-color var(--ak-motion-fast) var(--ak-ease-standard), color var(--ak-motion-fast) var(--ak-ease-standard); }
  button:hover:not(:disabled):not(.active) { color: var(--aibo-text); background: var(--aibo-hover); }
  .ak-model-matrix-wrap :is(.ak-model-matrix, .ak-model-matrix-tools) button { border-radius: 0; }
  .ak-model-matrix-wrap :is(.ak-model-matrix, .ak-model-matrix-tools) button:focus-visible { outline: var(--ak-focus-width) solid var(--aibo-focus); outline-offset: -2px; }
  td button.active, .ak-model-matrix-tools button.active { color: var(--aibo-info-text); background: var(--aibo-accent-soft); }
  button:disabled { cursor: not-allowed; opacity: .5; }
  .effort-mark { position: relative; z-index: 1; display: inline-flex; width: 28px; height: 16px; align-items: center; justify-content: center; }
  .effort-ticks { display: inline-flex; align-items: center; gap: 3px; }
  .effort-tick { width: 3px; height: 8px; background: var(--aibo-border); }
  .effort-tick.filled { background: var(--aibo-muted); }

  /* A finite charge sequence scales with the declared column order; the check stays still. */
  button[data-intensity] { --effort-cycle: var(--ak-motion-slow); --effort-repeats: 1; --effort-peak: 1.15; --effort-corner-opacity: 0; }
  button[data-intensity='2'] { --effort-cycle: calc(var(--ak-motion-slow) * 2); --effort-peak: 1.45; }
  button[data-intensity='3'] { --effort-cycle: calc(var(--ak-motion-slow) * 3); --effort-repeats: 2; --effort-peak: 1.7; --effort-corner-opacity: .55; }
  button[data-intensity='4'] { --effort-cycle: calc(var(--ak-motion-slow) * 2.2); --effort-repeats: 3; --effort-peak: 2; --effort-corner-opacity: .85; }
  .effort-selection { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; color: var(--aibo-info-text); }
  .effort-selection::before, .effort-selection::after { position: absolute; width: 7px; height: 7px; border-color: currentColor; border-style: solid; content: ''; opacity: var(--effort-corner-opacity); }
  .effort-selection::before { top: 4px; left: 4px; border-width: 1px 0 0 1px; }
  .effort-selection::after { right: 4px; bottom: 4px; border-width: 0 1px 1px 0; }
  .effort-charge { position: absolute; left: 50%; bottom: 5px; display: flex; gap: 3px; transform: translateX(-50%); }
  .effort-charge-tick { width: 3px; height: 3px; background: currentColor; opacity: .2; transform-origin: center bottom; }
  .effort-charge-tick.lit { opacity: .65; animation: effort-charge var(--effort-cycle) var(--ak-ease-standard) calc(var(--effort-step) * 60ms) var(--effort-repeats) both; }
  .effort-sweep { display: none; position: absolute; inset-block: 0; left: -55%; width: 55%; background: linear-gradient(110deg, transparent, color-mix(in srgb, var(--ak-signal-info) 35%, transparent), transparent); opacity: 0; }
  button:is([data-intensity='3'], [data-intensity='4']) .effort-sweep { display: block; animation: effort-sweep var(--effort-cycle) var(--ak-ease-standard) var(--effort-repeats) both; }
  button[data-intensity='4'] .effort-selection::before, button[data-intensity='4'] .effort-selection::after { animation: effort-corners var(--effort-cycle) var(--ak-ease-standard) var(--effort-repeats) both; }
  @keyframes effort-charge {
    0%, 100% { transform: scaleY(1); opacity: .65; }
    35% { transform: scaleY(var(--effort-peak)); opacity: 1; }
    65% { transform: scaleY(.7); opacity: .4; }
  }
  @keyframes effort-sweep {
    0% { transform: translateX(0); opacity: 0; }
    15% { opacity: .9; }
    65%, 100% { transform: translateX(300%); opacity: 0; }
  }
  @keyframes effort-corners {
    0%, 100% { opacity: var(--effort-corner-opacity); }
    35% { opacity: 1; }
    65% { opacity: .35; }
  }
  button:disabled :is(.effort-charge-tick, .effort-sweep), button:disabled .effort-selection::before, button:disabled .effort-selection::after { animation: none; }
  @media (prefers-reduced-motion: reduce) {
    .ak-model-matrix button .effort-selection::before, .ak-model-matrix button .effort-selection::after,
    .ak-model-matrix button .effort-selection :is(.effort-charge-tick, .effort-sweep) { animation: none; }
  }
</style>
