<script lang="ts">
  import { Button, Card, Icon, Textarea } from '$lib/ui-kit';
  import type { ContextAttachment } from '$lib/types';

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    text?: string;
    onAddAttachments: () => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onAbort: () => void;
  };

  let {
    selectedAgent,
    selectedSession,
    sessionArchived,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    text = $bindable(''),
    onAddAttachments,
    onAddDirectory,
    onRemoveAttachment,
    onSend,
    onQueue,
    onAbort,
  }: ComposerProps = $props();

  const pendingAttachments = $derived(attachments.filter((attachment) => attachment.turnId === null));
  const pendingAttachmentBytes = $derived(
    pendingAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  );

  function attachmentName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<Card as="form" class="composer" data-ui-component="composer" onsubmit={(event) => { event.preventDefault(); onSend(); }}>
  <div class="composer-body">
    {#if pendingAttachments.length > 0}
      <div class="composer-attachments" aria-label="上下文附件">
        {#each pendingAttachments as attachment (attachment.id)}
          <span class="composer-attachment" title={attachment.path}>
            <Icon name="folder" size={12} />
            <span>{attachmentName(attachment.path)}</span>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              class="composer-attachment-remove"
              aria-label={`移除附件 ${attachmentName(attachment.path)}`}
              onclick={() => onRemoveAttachment(attachment.id)}
              disabled={busy}
            >
              <Icon name="close" size={11} />
            </Button>
          </span>
        {/each}
      </div>
      <small class="composer-context-summary">
        上下文 · {pendingAttachments.length} 项 · 约 {formatBytes(pendingAttachmentBytes)}
      </small>
    {/if}
    <Textarea
      class="composer-textarea"
      data-composer-input="true"
      bind:value={text}
      rows="2"
      placeholder={sessionArchived ? '该会话已归档，请取消归档或创建分支继续…' : selectedSession ? '输入消息，⌘/Ctrl + Enter 发送…' : '先新建或选择一个 Agent 会话…'}
      disabled={!selectedSession || sessionArchived || selectedSessionArchiving || (sessionRunning && selectedAgent === 'codex') || busy}
      onkeydown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (sessionRunning && selectedAgent === 'pi') onQueue('steer');
          else onSend();
        }
      }}
    ></Textarea>
  </div>
  <Button
    variant="ghost"
    size="icon"
    type="button"
    onclick={onAddAttachments}
    disabled={!selectedSession || sessionArchived || selectedSessionArchiving || busy}
    aria-label="添加上下文"
    title="添加文件或目录"
  >
    <Icon name="folder-add" size={14} />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    type="button"
    onclick={onAddDirectory}
    disabled={!selectedSession || sessionArchived || selectedSessionArchiving || busy}
    aria-label="添加上下文目录"
    title="添加目录上下文"
  >
    <Icon name="folder" size={14} />
  </Button>
  {#if sessionRunning}
    {#if selectedAgent === 'pi'}
      <Button variant="outline" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || !text.trim()}>插入</Button>
      <Button variant="outline" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || !text.trim()}>跟进</Button>
    {/if}
    <Button variant="destructive" size="icon" type="button" onclick={onAbort} disabled={busy} aria-label="中止">
      <Icon name="stop" size={13} />
    </Button>
  {:else}
    <Button size="icon" type="submit" disabled={!selectedSession || sessionArchived || selectedSessionArchiving || !text.trim() || busy} aria-label="发送">
      <Icon name="send" size={14} />
    </Button>
  {/if}
</Card>
