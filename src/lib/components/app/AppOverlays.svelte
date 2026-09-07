<script lang="ts">
  import { AlertDialog, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '$lib/ui-kit';
  import type { PiTreeNavigationMode, PiTreeNavigationOptions } from '$lib/types';

  type AppOverlaysProps = {
    errorMessage: string | null;
    notice: string | null;
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
</script>

{#if errorMessage || notice}
  <div class="toast-region" aria-label="应用通知">
    {#if errorMessage}
      <Card class="toast error-toast" role="alert" aria-live="assertive" aria-atomic="true">
        {errorMessage}
      </Card>
    {/if}
    {#if notice}
      <Card class="toast notice-toast" role="status" aria-live="polite" aria-atomic="true">
        {notice}
      </Card>
    {/if}
  </div>
{/if}

<AlertDialog
  open={archiveConfirmationOpen}
  title="归档会话？"
  description="归档会隐藏会话，但不会删除 Aibo 中已保存的本地时间线。"
  confirmText="归档"
  cancelText="取消"
  onConfirm={onConfirmArchive}
  onCancel={onCancelArchive}
/>
{#if piNavigationOpen}
  <div class="alert-dialog-overlay" role="presentation" onclick={onCancelPiNavigation}>
    <Card class="pi-navigation-dialog" role="dialog" aria-modal="true" aria-labelledby="pi-navigation-title" onclick={(event) => event.stopPropagation()}>
      <CardHeader class="pi-navigation-dialog-header">
        <CardTitle id="pi-navigation-title">切换 Pi 会话树节点</CardTitle>
        <p>选择如何处理即将离开的分支。原分支会保留，可以随时切回。</p>
      </CardHeader>
      <CardContent class="pi-navigation-dialog-content">
        <div class="pi-navigation-mode-list" role="radiogroup" aria-label="分支总结方式">
          <Button variant={piNavigationMode === 'none' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'none'} onclick={() => onSetPiNavigationMode('none')}>
            <span><strong>No Summary</strong><small>直接切换，不为离开的分支生成总结</small></span>
          </Button>
          <Button variant={piNavigationMode === 'summary' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'summary'} onclick={() => onSetPiNavigationMode('summary')}>
            <span><strong>Summarize</strong><small>使用 Pi 默认提示总结离开的分支</small></span>
          </Button>
          <Button variant={piNavigationMode === 'custom' ? 'secondary' : 'outline'} type="button" role="radio" aria-checked={piNavigationMode === 'custom'} onclick={() => onSetPiNavigationMode('custom')}>
            <span><strong>Summarize with custom prompt</strong><small>在默认总结提示后追加你的要求</small></span>
          </Button>
        </div>
        {#if piNavigationMode === 'custom'}
          <Textarea
            value={piNavigationCustomInstructions}
            aria-label="自定义总结提示"
            placeholder="例如：重点保留尚未完成的任务、关键决策和文件变更…"
            oninput={(event) => onSetPiNavigationCustomInstructions((event.currentTarget as HTMLTextAreaElement).value)}
          />
        {/if}
      </CardContent>
      <div class="alert-dialog-actions">
        <Button variant="ghost" type="button" onclick={onCancelPiNavigation}>取消</Button>
        <Button type="button" onclick={() => onConfirmPiNavigation({ mode: piNavigationMode, customInstructions: piNavigationCustomInstructions })} disabled={piNavigationMode === 'custom' && !piNavigationCustomInstructions.trim()}>切换</Button>
      </div>
    </Card>
  </div>
{/if}
