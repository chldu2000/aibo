<script lang="ts">
  import { Button, Card, Icon, Textarea } from '$lib/ui-kit';
  import type { AgentCommand, ContextAttachment, WorkspacePathSuggestion } from '$lib/types';

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    workspacePathSuggestions: WorkspacePathSuggestion[];
    agentCommands: AgentCommand[];
    agentCommandsLoading: boolean;
    text?: string;
    onAddAttachments: () => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onAbort: () => void;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    selectedAgent,
    selectedSession,
    sessionArchived,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    workspacePathSuggestions,
    agentCommands,
    agentCommandsLoading,
    text = $bindable(''),
    onAddAttachments,
    onAddDirectory,
    onRemoveAttachment,
    onSend,
    onQueue,
    onAbort,
    onComposerInput,
    onSelectWorkspacePath,
  }: ComposerProps = $props();

  const pendingAttachments = $derived(attachments.filter((attachment) => attachment.turnId === null));
  const pendingAttachmentBytes = $derived(
    pendingAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  );

  let mentionActiveIndex = $state(0);
  let slashActiveIndex = $state(0);
  const activeMentionQuery = $derived.by(() => {
    const match = text.match(/(?:^|\s)@([^\s]*)$/);
    return match ? match[1] : null;
  });
  const activeSlashQuery = $derived.by(() => {
    const match = text.match(/^\/([^\s]*)$/);
    return match ? match[1].toLocaleLowerCase() : null;
  });
  const filteredAgentCommands = $derived.by(() => {
    if (activeSlashQuery === null) return [];
    return agentCommands
      .filter((command) => command.name.toLocaleLowerCase().startsWith(activeSlashQuery))
      .slice(0, 8);
  });
  const showMentionSuggestions = $derived(
    activeMentionQuery !== null && workspacePathSuggestions.length > 0,
  );
  const showSlashMenu = $derived(
    activeSlashQuery !== null && selectedAgent === 'pi' && slashActiveIndex >= 0,
  );

  function attachmentName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function updateComposerInput(value: string): void {
    mentionActiveIndex = 0;
    slashActiveIndex = 0;
    onComposerInput(value);
  }

  function selectWorkspacePath(suggestion: WorkspacePathSuggestion): void {
    text = text.replace(/(?:^|\s)@([^\s]*)$/, (match) => {
      const prefix = match.startsWith(' ') ? ' ' : '';
      return `${prefix}@${suggestion.path} `;
    });
    mentionActiveIndex = -1;
    onComposerInput(text);
    void onSelectWorkspacePath(suggestion.path);
  }

  function selectAgentCommand(command: AgentCommand): void {
    text = text.replace(/^\/([^\s]*)$/, `/${command.name} `);
    slashActiveIndex = -1;
    onComposerInput(text);
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
        if (showMentionSuggestions) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            mentionActiveIndex = (mentionActiveIndex + 1) % workspacePathSuggestions.length;
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            mentionActiveIndex = (mentionActiveIndex - 1 + workspacePathSuggestions.length) % workspacePathSuggestions.length;
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const suggestion = workspacePathSuggestions[mentionActiveIndex];
            if (suggestion) selectWorkspacePath(suggestion);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            mentionActiveIndex = -1;
            return;
          }
        }
        if (showSlashMenu && filteredAgentCommands.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            slashActiveIndex = (slashActiveIndex + 1) % filteredAgentCommands.length;
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            slashActiveIndex = (slashActiveIndex - 1 + filteredAgentCommands.length) % filteredAgentCommands.length;
            return;
          }
          if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
            event.preventDefault();
            const command = filteredAgentCommands[slashActiveIndex];
            if (command) selectAgentCommand(command);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            slashActiveIndex = -1;
            return;
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (sessionRunning && selectedAgent === 'pi') onQueue('steer');
          else onSend();
        }
      }}
      oninput={(event) => updateComposerInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></Textarea>
    {#if showMentionSuggestions && mentionActiveIndex >= 0}
      <div class="composer-suggestions" role="listbox" aria-label="工作区路径">
        {#each workspacePathSuggestions.slice(0, 8) as suggestion, index (`mention-${suggestion.path}`)}
          <button
            type="button"
            class:active={index === mentionActiveIndex}
            role="option"
            aria-selected={index === mentionActiveIndex}
            onclick={() => selectWorkspacePath(suggestion)}
            onmousedown={(event) => event.preventDefault()}
          >
            <Icon name={suggestion.isDirectory ? 'folder' : 'file'} size={13} />
            <span>{suggestion.path}</span>
            <small>{suggestion.isDirectory ? '目录' : '文件'}</small>
          </button>
        {/each}
      </div>
    {:else if showSlashMenu}
      <div class="composer-suggestions" role="listbox" aria-label="Agent 命令">
        {#if agentCommandsLoading && filteredAgentCommands.length === 0}
          <div class="composer-suggestions-empty">正在加载 Agent 命令…</div>
        {:else if filteredAgentCommands.length === 0}
          <div class="composer-suggestions-empty">
            {agentCommands.length === 0 ? '当前会话暂无可用 Agent 命令' : '没有匹配的 Agent 命令'}
          </div>
        {:else}
          {#each filteredAgentCommands as command, index (`slash-${command.source}-${command.name}`)}
            <button
              type="button"
              class:active={index === slashActiveIndex}
              role="option"
              aria-selected={index === slashActiveIndex}
              onclick={() => selectAgentCommand(command)}
              onmousedown={(event) => event.preventDefault()}
            >
              <span class="composer-command-prefix">/{command.name}</span>
              <span>{command.description ?? (command.source === 'skill' ? 'Skill' : command.source)}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
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
