<script lang="ts">
  import SendIcon from '@lucide/svelte/icons/send';
  import SquareIcon from '@lucide/svelte/icons/square';
  import { Button, Card, Textarea } from '$lib/ui-kit';

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    text?: string;
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
    text = $bindable(''),
    onSend,
    onQueue,
    onAbort,
  }: ComposerProps = $props();
</script>

<Card as="form" class="composer" data-ui-component="composer" onsubmit={(event) => { event.preventDefault(); onSend(); }}>
  <Textarea
    class="composer-textarea"
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
  {#if sessionRunning}
    {#if selectedAgent === 'pi'}
      <Button variant="outline" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || !text.trim()}>插入</Button>
      <Button variant="outline" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || !text.trim()}>跟进</Button>
    {/if}
    <Button variant="destructive" size="icon" type="button" onclick={onAbort} disabled={busy} aria-label="中止">
      <SquareIcon size={13} fill="currentColor" />
    </Button>
  {:else}
    <Button size="icon" type="submit" disabled={!selectedSession || sessionArchived || selectedSessionArchiving || !text.trim() || busy} aria-label="发送">
      <SendIcon size={14} />
    </Button>
  {/if}
</Card>
