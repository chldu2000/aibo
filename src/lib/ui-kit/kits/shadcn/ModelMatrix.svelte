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

<div class="shadcn-model-matrix-wrap">
  <table class="shadcn-model-matrix" aria-label="模型与推理强度">
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
            >{#if row.defaultActive}<Icon name="check" size={13} />{:else}<span aria-hidden="true">—</span>{/if}</button>
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
              >{#if cell.active}<Icon name="check" size={13} />{:else}<span aria-hidden="true">{cell.available ? '○' : '—'}</span>{/if}</button>
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
    border: 1px solid var(--aibo-border);
    border-radius: 7px;
  }

  .shadcn-model-matrix {
    width: 100%;
    min-width: max-content;
    border-collapse: separate;
    border-spacing: 0;
    color: var(--aibo-muted);
    font-size: 10px;
  }

  .shadcn-model-matrix th,
  .shadcn-model-matrix td {
    height: 32px;
    border-bottom: 1px solid var(--aibo-border);
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
    color: var(--aibo-subtle);
    background: var(--aibo-surface);
    font-size: 9px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
  }

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
    color: var(--aibo-muted);
    background: var(--aibo-surface);
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
    color: var(--aibo-subtle);
    font-size: 8px;
  }

  .shadcn-model-matrix tr.active-row th {
    color: var(--aibo-text);
    background: var(--aibo-accent-soft);
  }

  .shadcn-model-matrix td {
    width: 52px;
    padding: 2px;
    text-align: center;
  }

  .shadcn-model-matrix td button {
    display: inline-flex;
    width: 100%;
    height: 26px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 5px;
    padding: 0;
    color: var(--aibo-subtle);
    background: transparent;
    font-size: 13px;
    text-align: center;
  }

  .shadcn-model-matrix td button:hover:not(:disabled),
  .shadcn-model-matrix td button:focus-visible {
    color: var(--aibo-text);
    background: var(--aibo-surface-hover);
    outline: none;
  }

  .shadcn-model-matrix td button.active {
    color: var(--aibo-accent-foreground, var(--aibo-accent-text));
    background: var(--aibo-accent);
  }

  .shadcn-model-matrix td button:disabled {
    cursor: not-allowed;
    opacity: .35;
  }
</style>
