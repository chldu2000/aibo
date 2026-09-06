<script lang="ts">
  import { Button, Card, Icon, Input, ModelMatrix, Textarea } from '$lib/ui-kit';
  import type { UiModelMatrixRow } from '$lib/ui-kit';
  import type { AgentCommand, AgentCommandCategory, ContextAttachment, SessionAccessMode, SessionExecutionProfile, SessionModelCatalog, WorkspacePathSuggestion } from '$lib/types';

  type SlashCategory = 'all' | AgentCommandCategory;

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    selectedSessionId: string | null;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    executionProfile: SessionExecutionProfile | null;
    modelCatalog: SessionModelCatalog | null;
    modelCatalogLoading: boolean;
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
    onLoadModels: () => void | Promise<void>;
    onSelectModel: (model: string | null) => void | Promise<void>;
    onSelectReasoning: (reasoningEffort: string | null) => void | Promise<void>;
    onSelectModelConfiguration: (model: string, reasoningEffort: string | null) => void | Promise<void>;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    selectedAgent,
    selectedSession,
    selectedSessionId,
    sessionArchived,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    executionProfile,
    modelCatalog,
    modelCatalogLoading,
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
    onLoadModels,
    onSelectModel,
    onSelectReasoning,
    onSelectModelConfiguration,
    onComposerInput,
    onSelectWorkspacePath,
  }: ComposerProps = $props();

  const pendingAttachments = $derived(attachments.filter((attachment) => attachment.turnId === null));
  const pendingAttachmentBytes = $derived(
    pendingAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  );

  let mentionActiveIndex = $state(0);
  let slashActiveIndex = $state(0);
  let slashCategory = $state<SlashCategory>('all');
  let attachmentMenuOpen = $state(false);
  let sessionMenuOpen = $state(false);
  let modelMenuOpen = $state(false);
  let modelDraft = $state('');

  $effect(() => {
    // The category is a view preference for the current command list. A new
    // session can expose a completely different set of commands, so do not
    // carry a stale filter across the session boundary.
    selectedSessionId;
    slashCategory = 'all';
    slashActiveIndex = 0;
  });
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
      .filter((command) => {
        const category = command.category
          ?? (command.source === 'skill' ? 'skill' : command.source === 'extension' || command.source === 'prompt' ? 'extension' : 'agent');
        if (slashCategory !== 'all' && category !== slashCategory) return false;
        const query = activeSlashQuery.trim();
        if (!query) return true;
        const haystack = [command.name, ...(command.aliases ?? []), command.description ?? '']
          .join(' ')
          .toLocaleLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 24);
  });
  const slashCategories: Array<{ id: SlashCategory; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'agent', label: 'Agent' },
    { id: 'skill', label: 'Skills' },
    { id: 'extension', label: 'Extension' },
  ];
  const showMentionSuggestions = $derived(
    activeMentionQuery !== null && workspacePathSuggestions.length > 0,
  );
  const showSlashMenu = $derived(
    activeSlashQuery !== null && selectedAgent !== null && slashActiveIndex >= 0,
  );

  const activeProfile = $derived(executionProfile?.enforced ?? executionProfile?.requested ?? null);
  const codexPermissionMode = $derived<'ask-for-approval' | 'approve-for-me' | 'full-access' | null>(
    activeProfile?.filesystemPolicy === 'danger-full-access'
      ? 'full-access'
      : activeProfile?.filesystemPolicy === 'workspace-write' && activeProfile?.approvalPolicy === 'never'
        ? 'approve-for-me'
        : activeProfile?.filesystemPolicy === 'workspace-write' && activeProfile?.approvalPolicy === 'untrusted'
          ? 'ask-for-approval'
          : null,
  );
  const accessLabel = $derived(
    !selectedSession
      ? '会话设置'
      : selectedAgent === 'codex'
        ? codexPermissionMode === 'full-access' ? 'Full Access' : codexPermissionMode === 'approve-for-me' ? 'Approve for me' : codexPermissionMode === 'ask-for-approval' ? 'Ask for approval' : '配置 Codex 权限'
      : activeProfile?.filesystemPolicy === 'workspace-write'
        ? '工作区写入'
        : activeProfile?.interactionMode === 'plan'
          ? '计划模式'
          : '只读',
  );
  const accessDetail = $derived(
    selectedAgent === 'codex'
      ? codexPermissionMode === 'full-access' ? '由 Codex 原生控制 · 完整主机访问' : codexPermissionMode === 'approve-for-me' ? '由 Codex 原生控制 · 自动批准沙箱内操作' : codexPermissionMode === 'ask-for-approval' ? '由 Codex 原生控制 · 操作前请求批准' : '该会话使用历史权限配置；请选择一个 Codex 原生模式'
      : activeProfile
      ? `${activeProfile.filesystemPolicy === 'workspace-write' ? '可修改工作区' : '仅查看'} · ${activeProfile.commandPolicy === 'disabled' ? '命令关闭' : activeProfile.approvalPolicy === 'on-request' ? '命令需审批' : '命令受信任'}`
      : '选择会话后可查看当前执行配置',
  );
  const piAccessOptions: Array<{ mode: SessionAccessMode; label: string; detail: string }> = [
    { mode: 'read-only', label: '只读', detail: '查看文件，不修改工作区' },
    { mode: 'plan', label: '计划', detail: '分析并制定方案，不执行修改' },
    { mode: 'workspace-write', label: '工作区写入', detail: '允许修改工作区，命令需要审批' },
  ];
  const codexAccessOptions: Array<{ mode: SessionAccessMode; label: string; detail: string }> = [
    { mode: 'ask-for-approval', label: 'Ask for approval', detail: '由 Codex 在执行操作前请求你的批准' },
    { mode: 'approve-for-me', label: 'Approve for me', detail: '由 Codex 自动批准沙箱内的操作' },
    { mode: 'full-access', label: 'Full Access', detail: '由 Codex 以完整主机访问执行操作' },
  ];
  const accessOptions = $derived(selectedAgent === 'codex' ? codexAccessOptions : piAccessOptions);
  const activeAccessMode = $derived<SessionAccessMode | null>(
    selectedAgent === 'codex'
      ? codexPermissionMode
      : activeProfile?.filesystemPolicy === 'workspace-write'
      ? 'workspace-write'
      : activeProfile?.interactionMode === 'plan'
        ? 'plan'
        : 'read-only',
  );
  const modelLabel = $derived(
    modelOverride || modelCatalog?.current?.label || activeProfile?.model || (modelCatalogLoading ? '正在读取模型…' : '模型未读取'),
  );
  const currentReasoningEffort = $derived(
    modelCatalog?.currentReasoningEffort
      || activeProfile?.reasoningEffort
      || modelCatalog?.current?.defaultReasoningEffort
      || null,
  );
  const reasoningLabel = $derived(currentReasoningEffort ? ` · ${currentReasoningEffort}` : '');
  const selectedReasoningEffort = $derived(
    activeProfile?.reasoningEffort
      ?? (selectedAgent === 'pi' ? currentReasoningEffort : null),
  );
  const reasoningOptions = $derived(
    modelCatalog?.current?.reasoningEfforts?.length
      ? modelCatalog.current.reasoningEfforts
      : modelCatalog?.reasoningEfforts ?? [],
  );
  const matrixReasoningOptions = $derived.by(() => {
    const options = [
      ...(modelCatalog?.reasoningEfforts ?? []),
      ...(modelCatalog?.models.flatMap((model) => model.reasoningEfforts) ?? []),
    ];
    return [...new Map(options.map((option) => [option.id, option])).values()];
  });
  const matrixDefaultLabel = $derived(selectedAgent === 'codex' ? '默认' : '保留');
  const matrixRows = $derived.by((): UiModelMatrixRow[] =>
    (modelCatalog?.models ?? []).map((option) => ({
      reference: option.reference,
      label: option.label,
      isDefault: option.isDefault,
      active: option.reference === modelCatalog?.current?.reference,
      defaultActive: modelConfigurationIsActive(option, null),
      cells: matrixReasoningOptions.map((effort) => ({
        id: effort.id,
        label: effort.label,
        description: effort.description,
        available: supportsReasoningEffort(option, effort.id),
        active: modelConfigurationIsActive(option, effort.id),
      })),
    })),
  );
  const matrixDisabled = $derived(busy || sessionArchived || selectedSessionArchiving || sessionRunning);

  function supportsReasoningEffort(model: { reasoningEfforts: Array<{ id: string }> }, reasoningEffort: string | null): boolean {
    return reasoningEffort === null || model.reasoningEfforts.some((option) => option.id === reasoningEffort);
  }

  function modelConfigurationIsActive(model: { reference: string }, reasoningEffort: string | null): boolean {
    return model.reference === modelCatalog?.current?.reference
      && (reasoningEffort === null
        ? selectedAgent === 'codex' && selectedReasoningEffort === null
        : reasoningEffort === selectedReasoningEffort);
  }

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
    const nextOpen = !modelMenuOpen;
    modelDraft = modelOverride || modelCatalog?.current?.reference || activeProfile?.model || '';
    modelMenuOpen = nextOpen;
    attachmentMenuOpen = false;
    sessionMenuOpen = false;
    if (nextOpen && !modelCatalog && !modelCatalogLoading) void onLoadModels();
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
              variant="toolbar"
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
        if (showSlashMenu) {
          if (event.key === 'Tab') {
            event.preventDefault();
            const currentIndex = slashCategories.findIndex((category) => category.id === slashCategory);
            const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + slashCategories.length) % slashCategories.length;
            slashCategory = slashCategories[nextIndex]?.id ?? 'all';
            slashActiveIndex = 0;
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
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
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
        <div class="composer-command-categories" role="tablist" aria-label="命令分类">
          {#each slashCategories as category (`slash-category-${category.id}`)}
            <button
              type="button"
              role="tab"
              aria-selected={slashCategory === category.id}
              class:active={slashCategory === category.id}
              onclick={() => { slashCategory = category.id; slashActiveIndex = 0; }}
              onmousedown={(event) => event.preventDefault()}
            >{category.label}</button>
          {/each}
        </div>
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
              <span class="composer-command-description">{command.description ?? (command.source === 'skill' ? 'Skill' : command.source)}</span>
              <small>{command.category === 'skill' || command.source === 'skill' ? 'Skill' : command.category === 'extension' || command.source === 'extension' || command.source === 'prompt' ? 'Extension' : 'Agent'}</small>
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
          variant="toolbar"
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
            variant="toolbar"
            type="button"
            class="composer-toolbar-control composer-access-control"
            onclick={() => { sessionMenuOpen = !sessionMenuOpen; attachmentMenuOpen = false; modelMenuOpen = false; }}
            aria-haspopup="menu"
            aria-expanded={sessionMenuOpen}
            title={accessDetail}
          >
            <Icon name={activeProfile?.filesystemPolicy === 'danger-full-access' || activeProfile?.filesystemPolicy === 'workspace-write' ? 'trust' : 'untrust'} size={16} />
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
                    <Icon name={option.mode === 'full-access' || option.mode === 'approve-for-me' || option.mode === 'workspace-write' ? 'trust' : option.mode === 'plan' ? 'file' : 'untrust'} size={15} />
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
            variant="toolbar"
            type="button"
            class="composer-toolbar-control composer-model-control"
            onclick={(event) => { event.stopPropagation(); openModelMenu(); }}
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
              {#if modelCatalogLoading}
                <div class="composer-suggestions-empty">正在读取可用模型…</div>
              {:else if modelCatalog && modelCatalog.models.length > 0}
                <ModelMatrix
                  columns={matrixReasoningOptions}
                  rows={matrixRows}
                  defaultLabel={matrixDefaultLabel}
                  defaultTitle={selectedAgent === 'codex' ? '使用该模型的默认推理强度' : '切换模型，保留当前推理强度'}
                  disabled={matrixDisabled}
                  onSelect={(model, reasoningEffort) => {
                    modelDraft = model;
                    modelMenuOpen = false;
                    void onSelectModelConfiguration(model, reasoningEffort);
                  }}
                />
              {:else}
                <div class="composer-suggestions-empty">未获取到可用模型，可手动输入模型标识。</div>
              {/if}
              <Input bind:value={modelDraft} class="composer-model-input" placeholder={selectedAgent === 'pi' ? 'provider/model' : 'provider/model，留空使用默认'} aria-label="模型标识" />
              <Button
                size="sm"
                type="button"
                class="composer-model-apply"
                onclick={() => { modelMenuOpen = false; void onSelectModel(modelDraft.trim() || null); }}
                disabled={modelCatalogLoading || busy || sessionArchived || selectedSessionArchiving || sessionRunning || (selectedAgent === 'pi' && !modelDraft.trim())}
              >应用模型</Button>
            </div>
          {/if}
        </div>
      {/if}

      {#if sessionRunning}
        {#if selectedAgent === 'pi'}
          <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || !text.trim()}>插入</Button>
          <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || !text.trim()}>跟进</Button>
        {/if}
        <Button variant="abort" class="composer-action composer-action-abort" size="icon" type="button" onclick={onAbort} disabled={busy} aria-label="中止">
          <Icon name="stop" size={13} />
        </Button>
      {:else}
        <Button variant="send" class="composer-action composer-action-send" size="icon" type="submit" disabled={!selectedSession || sessionArchived || selectedSessionArchiving || !text.trim() || busy} aria-label="发送">
          <Icon name="send" size={16} />
        </Button>
      {/if}
    </div>
  </div>
</Card>
