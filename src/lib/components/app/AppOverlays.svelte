<script lang="ts">
  import { locale, t } from '$lib/i18n/runtime';
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import type { LocalizedText } from '../../../../packages/i18n/index.js';
  import { AlertDialog, Button, Card, CardContent, CardHeader, CardTitle, Icon, Textarea } from '$lib/ui-kit';
  import type { AppNotification, NotificationType } from '$lib/app/notifications';
  import type { UiIconName } from '$lib/ui-kit';
  import type { PiTreeNavigationMode, PiTreeNavigationOptions } from '$lib/types';

  type AppOverlaysProps = {
    errorMessage: LocalizedText | null;
    notice: AppNotification | null;
    archiveConfirmationOpen: boolean;
    piNavigationOpen: boolean;
    piNavigationMode: PiTreeNavigationMode;
    piNavigationCustomInstructions: string;
    onConfirmArchive: () => void;
    onCancelArchive: () => void;
    onSetPiNavigationMode: (mode: PiTreeNavigationMode) => void;
    onSetPiNavigationCustomInstructions: (value: string) => void;
    onConfirmPiNavigation: (options: PiTreeNavigationOptions) => void;
    onCancelPiNavigation: () => void;
  };

  let {
    errorMessage,
    notice,
    archiveConfirmationOpen,
    piNavigationOpen,
    piNavigationMode,
    piNavigationCustomInstructions,
    onConfirmArchive,
    onCancelArchive,
    onSetPiNavigationMode,
    onSetPiNavigationCustomInstructions,
    onConfirmPiNavigation,
    onCancelPiNavigation,
  }: AppOverlaysProps = $props();

  const notificationLabels: Record<NotificationType, string> = $derived({
    success: $t('notification.success'), info: $t('notification.info'), warning: $t('notification.warning'), error: $t('notification.error'),
  });
  const notificationIcons: Record<NotificationType, UiIconName> = {
    success: 'check', info: 'info', warning: 'warning', error: 'error',
  };
  const notifications = $derived<AppNotification[]>([
    ...(errorMessage ? [{ type: 'error' as const, message: errorMessage }] : []),
    ...(notice ? [notice] : []),
  ]);
</script>

{#if notifications.length}
  <div class="toast-region" aria-label={$t('notification.region')}>
    {#each notifications as notification}
      <Card class={`toast ${notification.type}-toast`} data-notification-type={notification.type}
        role={notification.type === 'error' ? 'alert' : 'status'}
        aria-live={notification.type === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
        <span class="toast-symbol"><Icon name={notificationIcons[notification.type]} /></span>
        <div class="toast-copy">
          <strong class="toast-label">{notificationLabels[notification.type]}</strong>
          <span>{translateMessage($locale, notification.message)}</span>
        </div>
      </Card>
    {/each}
  </div>
{/if}

<AlertDialog
  open={archiveConfirmationOpen}
  title={$t('archive.confirmTitle')}
  description={$t('archive.confirmDescription')}
  confirmText={$t('sidebar.archiveHint')}
  cancelText={$t('common.cancel')}
  onConfirm={onConfirmArchive}
  onCancel={onCancelArchive}
/>
{#if piNavigationOpen}
  <div class="alert-dialog-overlay" role="presentation" onclick={onCancelPiNavigation}>
    <Card class="pi-navigation-dialog" role="dialog" aria-modal="true" aria-labelledby="pi-navigation-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="pi-navigation-dialog-header">
        <CardTitle id="pi-navigation-title">{$t('navigation.title')}</CardTitle>
        <p>{$t('navigation.description')}</p>
      </CardHeader>
      <CardContent class="pi-navigation-dialog-content">
        <div class="pi-navigation-mode-list" role="radiogroup" aria-label={$t('navigation.summaryMode')}>
          <Button variant={piNavigationMode === 'none' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'none'} onclick={() => onSetPiNavigationMode('none')}>
            <span><strong>{$t('navigation.mode.none')}</strong><small>{$t('navigation.noSummary')}</small></span>
          </Button>
          <Button variant={piNavigationMode === 'summary' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'summary'} onclick={() => onSetPiNavigationMode('summary')}>
            <span><strong>{$t('navigation.mode.default')}</strong><small>{$t('navigation.defaultSummary')}</small></span>
          </Button>
          <Button variant={piNavigationMode === 'custom' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'custom'} onclick={() => onSetPiNavigationMode('custom')}>
            <span><strong>{$t('navigation.mode.custom')}</strong><small>{$t('navigation.customSummary')}</small></span>
          </Button>
        </div>
        {#if piNavigationMode === 'custom'}
          <Textarea
            value={piNavigationCustomInstructions}
            aria-label={$t('navigation.customPrompt')}
            placeholder={$t('navigation.placeholder')}
            oninput={(event) => onSetPiNavigationCustomInstructions((event.currentTarget as HTMLTextAreaElement).value)}
          />
        {/if}
      </CardContent>
      <div class="alert-dialog-actions">
        <Button variant="ghost" type="button" onclick={onCancelPiNavigation}>{$t('common.cancel')}</Button>
        <Button type="button" onclick={() => onConfirmPiNavigation({ mode: piNavigationMode, customInstructions: piNavigationCustomInstructions })} disabled={piNavigationMode === 'custom' && !piNavigationCustomInstructions.trim()}>{$t('navigation.switch')}</Button>
      </div>
    </Card>
  </div>
{/if}
