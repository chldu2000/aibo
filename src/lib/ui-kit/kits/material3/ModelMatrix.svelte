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
</script>

<div class="m3-model-matrix-wrap">
  <table class="m3-model-matrix" aria-label="模型与推理强度">
    <thead>
      <tr>
        <th scope="col">模型</th>
        <th scope="col" title={defaultTitle}>{defaultLabel}</th>
        {#each columns as column (column.id)}
          <th scope="col" title={column.description ?? column.label}>{column.label}</th>
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
            >{#if row.defaultActive}<Icon name="check" size={14} />{:else}<span aria-hidden="true">—</span>{/if}</button>
          </td>
          {#each row.cells as cell (cell.id)}
            <td>
              <button
                type="button"
                class:active={cell.active}
                aria-label={`${row.label}，${cell.label}`}
                aria-pressed={cell.active}
                disabled={!cell.available || disabled}
                title={cell.available ? `${row.label} · ${cell.label}` : `${row.label} 不支持 ${cell.label}`}
                onclick={() => onSelect(row.reference, cell.id)}
              >{#if cell.active}<Icon name="check" size={14} />{:else}<span aria-hidden="true">{cell.available ? '○' : '—'}</span>{/if}</button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .m3-model-matrix-wrap {
    max-height: 250px;
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
    font-size: 11px;
  }

  .m3-model-matrix th,
  .m3-model-matrix td {
    height: 36px;
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
    min-width: 56px;
    padding: 0 8px;
    color: var(--m3c-on-surface-variant);
    background: var(--m3c-surface-container);
    font-size: 10px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
  }

  .m3-model-matrix thead th:first-child {
    z-index: 2;
    left: 0;
    min-width: 144px;
    text-align: left;
  }

  .m3-model-matrix tbody th {
    position: sticky;
    z-index: 1;
    left: 0;
    max-width: 164px;
    padding: 0 10px;
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
    font-size: 9px;
  }

  .m3-model-matrix tr.active-row th {
    color: var(--m3c-on-surface);
    background: var(--m3c-primary-container);
  }

  .m3-model-matrix td {
    width: 56px;
    padding: 3px;
    text-align: center;
  }

  .m3-model-matrix td button {
    display: inline-flex;
    width: 100%;
    height: 30px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--m3-shape-small);
    padding: 0;
    color: var(--m3c-on-surface-variant);
    background: transparent;
    font-size: 14px;
    text-align: center;
    transition: background-color 150ms ease, color 150ms ease;
  }

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

  .m3-model-matrix td button:disabled {
    cursor: not-allowed;
    opacity: .38;
  }
</style>
