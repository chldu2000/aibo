<script lang="ts">
  import { t, locale } from '$lib/i18n/runtime';
  import type { UiManagementDataViewProps } from '../../contract';
  let { status, data, ownerTitle }: UiManagementDataViewProps = $props();
  const time = (value: string | number) => new Date(value).toLocaleString($locale);
  const ratio = (value: number, maximum: number) => Math.min(1, Math.max(0, value / maximum));
</script>

<div class="settings-section-body ui-data-view" data-ui-component="management-data-view" aria-busy={status === 'loading'}>
  {#if status === 'disabled'}<p role="status">{$t('management.enableToRead')}</p>
  {:else if status === 'failed'}<p role="alert">{$t('management.readUnavailable')}</p>
  {:else if status === 'ready' && data}
    {#if data.target.label !== ownerTitle}<h3 class="settings-rows-title">{data.target.label}</h3>{/if}
    {#if data.message}<p class="settings-row-meta" role="status">{data.message}</p>{/if}
    {#if data.properties.length || data.metrics.length}
      <div class="settings-rows">
        {#each data.properties as property (property.key)}
          <div class="settings-row">
            <div class="settings-copy"><span class="settings-row-title">{property.label}</span></div>
            <span class="ui-data-value">{property.value}</span>
          </div>
        {/each}
        {#each data.metrics as metric (metric.key)}
          {@const maximum = metric.maximum ?? (metric.unit === '%' ? 100 : undefined)}
          <div class="settings-row">
            <div class="settings-copy">
              <span class="settings-row-title">{metric.label}</span>
              {#if metric.resetsAt}<span class="settings-row-meta">{$t('management.resetsAt', { time: time(metric.resetsAt * 1000) })}</span>{/if}
            </div>
            <span class="ui-data-value">{metric.value}{metric.unit}</span>
            {#if maximum}
              <div class="ui-meter" role="meter" aria-label={metric.label} aria-valuemin={0} aria-valuemax={maximum}
                aria-valuenow={metric.value} aria-valuetext="{metric.value}{metric.unit}">
                <span style:inline-size="{ratio(metric.value, maximum) * 100}%"></span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    <p class="settings-row-meta">{$t('management.observedAt', { time: time(data.observedAt) })}</p>
  {:else}<p role="status">{$t('management.loading')}</p>{/if}
</div>
