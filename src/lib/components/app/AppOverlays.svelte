<script lang="ts">
  import { AlertDialog, Card } from '$lib/ui-kit';

  type AppOverlaysProps = {
    errorMessage: string | null;
    notice: string | null;
    archiveConfirmationOpen: boolean;
    piNavigationOpen: boolean;
    onConfirmArchive: () => void;
    onCancelArchive: () => void;
    onConfirmPiNavigation: () => void;
    onCancelPiNavigation: () => void;
  };

  let {
    errorMessage,
    notice,
    archiveConfirmationOpen,
    piNavigationOpen,
    onConfirmArchive,
    onCancelArchive,
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
<AlertDialog
  open={piNavigationOpen}
  title="切换 Pi 分支？"
  description="切换只会移动 Pi 原生 session 的当前 leaf，不会删除 Aibo 已保存的时间线；切换后仍可返回其他分支。"
  confirmText="切换"
  cancelText="取消"
  onConfirm={onConfirmPiNavigation}
  onCancel={onCancelPiNavigation}
/>
