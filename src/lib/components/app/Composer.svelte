<script lang="ts">
  import { Button, Card, Icon, Textarea } from '$lib/ui-kit';
  import type { AgentCommand, ContextAttachment, SessionAccessMode, SessionExecutionProfile, WorkspacePathSuggestion } from '$lib/types';

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    executionProfile: SessionExecutionProfile | null;
    modelOverride?: string | null;
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
    onSelectAccess: (mode: SessionAccessMode) => void | Promise<void>;
    onSelectModel: (model: string | null) => void | Promise<void>;
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
    executionProfile,
    modelOverride = null,
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
    onSelectAccess,
    onSelectModel,
    onComposerInput,
    onSelectWorkspacePath,
  }: ComposerProps = $props();

  const pendingAttachments = $derived(attachments.filter((attachment) => attachment.turnId === null));
  const pendingAttachmentBytes = $derived(
    pendingAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  );

  let mentionActiveIndex = $state(0);
  let slashActiveIndex = $state(0);
  let attachmentMenuOpen = $state(false);
  let sessionMenuOpen = $state(false);
  let modelMenuOpen = $state(false);
  let modelDraft = $state('');
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
    activeSlashQuery !== null && selectedAgent !== null && slashActiveIndex >= 0,
  );

  const activeProfile = $derived(executionProfile?.enforced ?? executionProfile?.requested ?? null);
  const accessLabel = $derived(
    !selectedSession
      ? '会话设置'
      : activeProfile?.filesystemPolicy === 'workspace-write'
        ? '工作区写入'
        : activeProfile?.interactionMode === 'plan'
          ? '计划模式'
          : '只读',
  );
  const accessDetail = $derived(
    activeProfile
      ? `${activeProfile.filesystemPolicy === 'workspace-write' ? '可修改工作区' : '仅查看'} · ${activeProfile.commandPolicy === 'disabled' ? '命令关闭' : activeProfile.approvalPolicy === 'on-request' ? '命令需审批' : '命令受信任'}`
      : '选择会话后可查看当前执行配置',
  );
  const accessOptions: Array<{ mode: SessionAccessMode; label: string; detail: string }> = [
    { mode: 'read-only', label: '只读', detail: '查看文件，不修改工作区' },
    { mode: 'plan', label: '计划', detail: '分析并制定方案，不执行修改' },
    { mode: 'workspace-write', label: '工作区写入', detail: '允许修改工作区，命令需要审批' },
  ];
  const activeAccessMode = $derived<SessionAccessMode>(
    activeProfile?.filesystemPolicy === 'workspace-write'
      ? 'workspace-write'
      : activeProfile?.interactionMode === 'plan'
        ? 'plan'
        : 'read-only',
  );
  const modelLabel = $derived(
    modelOverride || activeProfile?.model || (selectedAgent === 'codex' ? 'Codex 默认模型' : selectedAgent === 'pi' ? 'Pi 默认模型' : '模型'),
  );
  const reasoningLabel = $derived(activeProfile?.reasoningEffort ? ` · ${activeProfile.reasoningEffort}` : '');

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

  function handleWindowClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('.composer-menu-anchor')) return;
    attachmentMenuOpen = false;
    sessionMenuOpen = false;
    modelMenuOpen = false;
  }

  function openModelMenu(): void {
    modelDraft = modelOverride || activeProfile?.model || '';
    modelMenuOpen = !modelMenuOpen;
    attachmentMenuOpen = false;
    sessionMenuOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

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
  <div class="composer-toolbar">
    <div class="composer-toolbar-group composer-toolbar-start">
      <div class="composer-menu-anchor">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          class="composer-toolbar-icon"
          onclick={() => { attachmentMenuOpen = !attachmentMenuOpen; sessionMenuOpen = false; modelMenuOpen = false; }}
          disabled={!selectedSession || sessionArchived || selectedSessionArchiving || busy}
          aria-label="添加上下文"
          aria-haspopup="menu"
          aria-expanded={attachmentMenuOpen}
          title="添加上下文"
        >
          <Icon name="add" size={20} />
        </Button>
        {#if attachmentMenuOpen}
          <div class="composer-menu composer-attachment-menu" role="menu" aria-label="添加上下文">
            <button type="button" role="menuitem" onclick={() => { attachmentMenuOpen = false; onAddAttachments(); }}>
              <Icon name="folder-add" size={15} />
              <span>添加文件</span>
            </button>
            <button type="button" role="menuitem" onclick={() => { attachmentMenuOpen = false; onAddDirectory(); }}>
              <Icon name="folder" size={15} />
              <span>添加目录</span>
            </button>
          </div>
        {/if}
      </div>

      {#if selectedSession}
        <div class="composer-menu-anchor">
          <Button
            variant="ghost"
            type="button"
            class="composer-toolbar-control composer-access-control"
            onclick={() => { sessionMenuOpen = !sessionMenuOpen; attachmentMenuOpen = false; modelMenuOpen = false; }}
            aria-haspopup="menu"
            aria-expanded={sessionMenuOpen}
            title={accessDetail}
          >
            <Icon name={activeProfile?.filesystemPolicy === 'workspace-write' ? 'trust' : 'untrust'} size={16} />
            <span>{accessLabel}</span>
          </Button>
          {#if sessionMenuOpen}
            <div class="composer-menu composer-profile-menu" role="menu" aria-label="会话设置">
              <div class="composer-menu-heading">会话权限</div>
              <div class="composer-menu-detail">{accessDetail}</div>
              <div class="composer-access-options" role="group" aria-label="选择会话权限">
                {#each accessOptions as option (option.mode)}
                  <button
                    class:active={option.mode === activeAccessMode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.mode === activeAccessMode}
                    onclick={() => {
                      sessionMenuOpen = false;
                      if (option.mode !== activeAccessMode) void onSelectAccess(option.mode);
                    }}
                    disabled={busy || selectedSessionArchiving || sessionRunning}
                  >
                    <Icon name={option.mode === 'workspace-write' ? 'trust' : option.mode === 'plan' ? 'file' : 'untrust'} size={15} />
                    <span class="composer-access-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                    {#if option.mode === activeAccessMode}<Icon name="check" size={14} />{/if}
                  </button>
                {/each}
              </div>
              {#if executionProfile?.unsupported && executionProfile.unsupported.length > 0}
                <div class="composer-menu-warning">未启用：{executionProfile.unsupported.join('、')}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="composer-toolbar-group composer-toolbar-end">
      {#if selectedSession}
        <div class="composer-menu-anchor">
          <Button
            variant="ghost"
            type="button"
            class="composer-toolbar-control composer-model-control"
            onclick={openModelMenu}
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
            title={`${modelLabel}${reasoningLabel}`}
          >
            <span class="composer-model-label">{modelLabel}{reasoningLabel}</span>
            <Icon name="chevron-down" size={15} />
          </Button>
          {#if modelMenuOpen}
            <div class="composer-menu composer-model-menu" role="menu" aria-label="模型设置">
              <div class="composer-menu-heading">模型与推理</div>
              <div class="composer-menu-detail">当前：{modelLabel}{reasoningLabel}</div>
              <Input bind:value={modelDraft} class="composer-model-input" placeholder={selectedAgent === 'pi' ? 'provider/model' : 'provider/model，留空使用默认'} aria-label="模型标识" />
              <Button
                size="sm"
                type="button"
                class="composer-model-apply"
                onclick={() => { modelMenuOpen = false; void onSelectModel(modelDraft.trim() || null); }}
                disabled={busy || selectedSessionArchiving || sessionRunning || (selectedAgent === 'pi' && !modelDraft.trim())}
              >应用模型</Button>
            </div>
          {/if}
        </div>
      {/if}

      {#if sessionRunning}
        {#if selectedAgent === 'pi'}
          <Button variant="outline" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || !text.trim()}>插入</Button>
          <Button variant="outline" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || !text.trim()}>跟进</Button>
        {/if}
        <Button variant="destructive" size="icon" type="button" onclick={onAbort} disabled={busy} aria-label="中止">
          <Icon name="stop" size={13} />
        </Button>
      {:else}
        <Button class="composer-send" size="icon" type="submit" disabled={!selectedSession || sessionArchived || selectedSessionArchiving || !text.trim() || busy} aria-label="发送">
          <Icon name="send" size={16} />
        </Button>
      {/if}
    </div>
  </div>
</Card>
