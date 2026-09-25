<script lang="ts">
  import type { UiModelMatrixProps } from '../../contract';
  import Icon from '../../runtime/Icon.svelte';

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

<div class="ui-model-matrix-wrap">
  {#if fastTier}
    <div class="ui-model-matrix-tools">
      <button type="button" class:active={fastTier.active} aria-label={fastTier.label} aria-pressed={fastTier.active}
        disabled={disabled} title={fastTier.description ?? fastTier.label}
        onclick={() => onSelectServiceTier(fastTier.active ? 'default' : fastTier.id)}><Icon name="bolt" size={15} /><span>{fastTier.label}</span></button>
    </div>
  {/if}
  <table class="ui-model-matrix" aria-label="模型与推理强度">
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
