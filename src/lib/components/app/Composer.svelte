<script lang="ts">
  import { tick } from 'svelte';
  import { commandComposerInsertion } from '$lib/app/agent-commands';
  import { sessionAgentKind } from '$lib/app/agent-kind';
  import { filterMentionSuggestions, type MentionCategory } from '$lib/app/mention-suggestions';
  import type { ModelConfigurationState } from '$lib/app/model-configuration';
  import { AgentStatusMark, Button, Card, Icon, ModelContextSelect, ModelMatrix, Textarea } from '$lib/ui-kit';
  import type { UiModelMatrixRow } from '$lib/ui-kit';
  import type { AgentCommand, AgentCommandCategory, ContextAttachment, SessionAccessMode, SessionExecutionProfile, SessionModelCatalog, Session, WorkspacePathSuggestion } from '$lib/types';
  import { scrollActiveOptionIntoView } from './active-option-scroll';

  type SlashCategory = 'all' | AgentCommandCategory;

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionCapabilities: string[];
    selectedSessionId: string | null;
    sessionArchived: boolean;
    sessionRunning: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    executionProfile: SessionExecutionProfile | null;
    modelConfiguration: ModelConfigurationState;
    modelCatalog: SessionModelCatalog | null;
    modelCatalogLoading: boolean;
    modelOverride?: string | null;
    workspacePathSuggestions: WorkspacePathSuggestion[];
    sessionSuggestions?: Session[];
    sessionIcons?: Record<string, import('../../../../packages/plugin-protocol/src/agent-icon').AgentIcon | undefined>;
    onSelectSessionReference?: (id: string) => void | Promise<void>;
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
    onSelectModelConfiguration: (model: string, reasoningEffort: string | null) => void | Promise<void>;
    onSelectServiceTier: (serviceTier: string) => void | Promise<void>;
    onSelectContextWindow: (contextWindow: string, modelReference: string) => void | Promise<void>;
    onComposerInput: (text: string) => void;
    onSelectWorkspacePath: (path: string) => void | Promise<void>;
  };

  let {
    selectedAgent,
    selectedSession,
    sessionCapabilities,
    selectedSessionId,
    sessionArchived,
    sessionRunning,
    selectedSessionArchiving,
    busy,
    attachments,
    executionProfile,
    modelConfiguration,
    modelCatalog,
    modelCatalogLoading,
    modelOverride = null,
    workspacePathSuggestions,
    sessionSuggestions = [],
    sessionIcons = {},
    onSelectSessionReference,
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
    onSelectModelConfiguration,
    onSelectServiceTier,
    onSelectContextWindow,
    onComposerInput,
    onSelectWorkspacePath,
  }: ComposerProps = $props();

  const pendingAttachments = $derived(attachments.filter((attachment) => attachment.turnId === null));
  const pendingAttachmentBytes = $derived(
    pendingAttachments.reduce((total, attachment) => total + (attachment.size ?? 0), 0),
  );

  let mentionActiveIndex = $state(0);
  let mentionCategory = $state<MentionCategory>('all');
  let slashActiveIndex = $state(0);
  let slashCategory = $state<SlashCategory>('all');
  let attachmentMenuOpen = $state(false);
  let sessionMenuOpen = $state(false);
  let modelMenuOpen = $state(false);
  let suggestionList: HTMLElement | null = $state(null);

  $effect(() => {
    // The category is a view preference for the current command list. A new
    // session can expose a completely different set of commands, so do not
    // carry a stale filter across the session boundary.
    selectedSessionId;
    mentionCategory = 'all';
    mentionActiveIndex = 0;
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
    { id: 'all', label: 'All' },
    { id: 'agent', label: 'Agent' },
    { id: 'skill', label: 'Skills' },
    { id: 'extension', label: 'Extension' },
  ];
  const mentionCategories: Array<{ id: MentionCategory; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'files', label: 'Files' },
    { id: 'folders', label: 'Folders' },
    { id: 'sessions', label: 'Sessions' },
  ];
  const mentionSuggestions = $derived(filterMentionSuggestions(sessionSuggestions, workspacePathSuggestions, mentionCategory));
  function selectMention(index: number): void {
    const item = mentionSuggestions[index];
    if (!item) return;
    mentionActiveIndex = -1;
    if (item.kind === 'session') void onSelectSessionReference?.(item.session.id);
    else selectWorkspacePath(item.path);
  }
  const showMentionSuggestions = $derived(
    activeMentionQuery !== null && mentionActiveIndex >= 0,
  );
  const showSlashMenu = $derived(
    activeSlashQuery !== null && selectedSession && slashActiveIndex >= 0,
  );

  const activeProfile = $derived(executionProfile?.enforced ?? executionProfile?.requested ?? null);
  const codexPermissionMode = $derived<'ask-for-approval' | 'approve-for-me' | 'full-access' | null>(
    activeProfile?.filesystemPolicy === 'danger-full-access'
      ? 'full-access'
      : activeProfile?.filesystemPolicy === 'workspace-write' && activeProfile?.approvalPolicy === 'on-request' && activeProfile?.approvalReviewer === 'auto-review'
        ? 'approve-for-me'
        : activeProfile?.filesystemPolicy === 'workspace-write' && activeProfile?.approvalPolicy === 'on-request' && activeProfile?.approvalReviewer === 'user'
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
  const currentReasoningEffort = $derived(modelConfiguration.currentReasoningEffort);
  const reasoningLabel = $derived(currentReasoningEffort ? ` · ${currentReasoningEffort}` : '');
  const selectedReasoningEffort = $derived(modelConfiguration.selectedReasoningEffort);
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
  const matrixDefaultLabel = $derived(modelConfiguration.defaultAction === 'reset' ? '默认' : '保留');
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
  const matrixFastTier = $derived.by(() => {
    if (!sessionCapabilities.includes('model.service-tier')) return null;
    const tier = modelCatalog?.current?.serviceTiers.find((option) => option.label.trim().toLowerCase() === 'fast') ?? null;
    return tier ? { ...tier, active: modelCatalog?.currentServiceTier === tier.id } : null;
  });

  function supportsReasoningEffort(model: { reasoningEfforts: Array<{ id: string }> }, reasoningEffort: string | null): boolean {
    return reasoningEffort === null || model.reasoningEfforts.some((option) => option.id === reasoningEffort);
  }

  function modelConfigurationIsActive(model: { reference: string }, reasoningEffort: string | null): boolean {
    return model.reference === modelCatalog?.current?.reference
      && (reasoningEffort === null
        ? modelConfiguration.defaultAction === 'reset' && selectedReasoningEffort === null
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

  async function scrollToActiveSuggestion(): Promise<void> {
    await tick();
    scrollActiveOptionIntoView(suggestionList);
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
    text = text.replace(/^\/([^\s]*)$/, commandComposerInsertion(selectedAgent, command));
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
            <span>{(attachment.mediaType === 'application/vnd.aibo.session-reference+json' ? attachment.path : attachmentName(attachment.path))}</span>
            <Button
              variant="toolbar"
              size="icon"
              type="button"
              class="composer-attachment-remove"
              aria-label={`移除附件 ${(attachment.mediaType === 'application/vnd.aibo.session-reference+json' ? attachment.path : attachmentName(attachment.path))}`}
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
    <Textarea data-presentation-focus="composer"
      class="composer-textarea"
      data-composer-input="true"
      bind:value={text}
      rows="2"
      placeholder={sessionArchived ? '该会话已归档，请取消归档或创建分支继续…' : selectedSession ? '输入消息，⌘/Ctrl + Enter 发送…' : '先新建或选择一个 Agent 会话…'}
      disabled={!selectedSession || sessionArchived || selectedSessionArchiving || (sessionRunning && !sessionCapabilities.includes('queue.manage')) || busy}
      onkeydown={(event) => {
        if (showMentionSuggestions) {
          if (event.key === 'Tab') {
            event.preventDefault();
            const currentIndex = mentionCategories.findIndex((category) => category.id === mentionCategory);
            const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + mentionCategories.length) % mentionCategories.length;
            mentionCategory = mentionCategories[nextIndex]?.id ?? 'all';
            mentionActiveIndex = 0;
            void scrollToActiveSuggestion();
            return;
          }
        }
        if (showMentionSuggestions && mentionSuggestions.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            mentionActiveIndex = (mentionActiveIndex + 1) % mentionSuggestions.length;
            void scrollToActiveSuggestion();
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            mentionActiveIndex = (mentionActiveIndex - 1 + mentionSuggestions.length) % mentionSuggestions.length;
            void scrollToActiveSuggestion();
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            selectMention(mentionActiveIndex);
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
            void scrollToActiveSuggestion();
            return;
          }
        }
        if (showSlashMenu && filteredAgentCommands.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            slashActiveIndex = (slashActiveIndex + 1) % filteredAgentCommands.length;
            void scrollToActiveSuggestion();
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            slashActiveIndex = (slashActiveIndex - 1 + filteredAgentCommands.length) % filteredAgentCommands.length;
            void scrollToActiveSuggestion();
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
          if (sessionRunning && sessionCapabilities.includes('queue.manage')) onQueue('followUp');
          else onSend();
        }
      }}
      oninput={(event) => updateComposerInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></Textarea>
    {#if showMentionSuggestions && mentionActiveIndex >= 0}
      <div class="composer-suggestions" role="group" aria-label="引用会话或工作区路径">
        <div class="composer-command-categories" role="tablist" aria-label="引用分类">
          {#each mentionCategories as category (`mention-category-${category.id}`)}
            <button
              type="button"
              role="tab"
              aria-selected={mentionCategory === category.id}
              class:active={mentionCategory === category.id}
              onclick={() => { mentionCategory = category.id; mentionActiveIndex = 0; }}
              onmousedown={(event) => event.preventDefault()}
            >{category.label}</button>
          {/each}
        </div>
        <div bind:this={suggestionList} class="composer-suggestion-options" role="listbox" aria-label="引用建议">
          {#if mentionSuggestions.length === 0}
            <div class="composer-suggestions-empty">没有匹配的引用</div>
          {/if}
          {#each mentionSuggestions as suggestion, index (suggestion.kind === 'session' ? `session-${suggestion.session.id}` : `path-${suggestion.path.path}`)}
            <button
              type="button"
              class:active={index === mentionActiveIndex}
              role="option"
              aria-selected={index === mentionActiveIndex}
              onclick={() => selectMention(index)}
              onmousedown={(event) => event.preventDefault()}
            >
              {#if suggestion.kind === 'session'}
                <AgentStatusMark agent={sessionAgentKind(suggestion.session)} icon={sessionIcons[suggestion.session.id]} tone="idle" label={`${suggestion.session.agent} 会话`} />
              {:else}
                <Icon name={suggestion.kind === 'folder' ? 'folder' : 'file'} size={13} />
              {/if}
              <span>{suggestion.kind === 'session' ? suggestion.session.label : suggestion.path.path}</span>
              <small>{suggestion.kind === 'session' ? `会话 · ${suggestion.session.agent}${suggestion.session.archived ? ' · 已归档' : ''}` : suggestion.kind === 'folder' ? '目录' : '文件'}</small>
            </button>
          {/each}
        </div>
      </div>
    {:else if showSlashMenu}
      <div class="composer-suggestions" role="group" aria-label="Agent 命令">
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
        <div bind:this={suggestionList} class="composer-suggestion-options" role="listbox" aria-label="命令建议">
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
            title={`${modelLabel}${reasoningLabel}${matrixFastTier?.active ? ' · Fast 已开启' : ''}`}
            aria-label={`${modelLabel}${reasoningLabel}${matrixFastTier?.active ? '，Fast 已开启' : ''}`}
          >
            {#if matrixFastTier?.active}
              <Icon name="bolt" size={15} />
            {/if}
            <span class="composer-model-label">{modelLabel}{reasoningLabel}</span>
            <Icon name="chevron-down" size={15} />
          </Button>
          {#if modelMenuOpen}
            <div class="composer-menu composer-model-menu" role="menu" aria-label="模型设置">
              <div class="composer-model-header">
                <div class="composer-model-header-labels">
                  <div class="composer-menu-heading">模型与推理</div>
                  <div class="composer-menu-detail">当前：{modelLabel}{reasoningLabel}</div>
                </div>
                <div class="composer-model-options">
                {#if matrixFastTier && !modelCatalogLoading}
                  <Button
                    type="button"
                    size="sm"
                    variant={matrixFastTier.active ? 'default' : 'outline'}
                    disabled={matrixDisabled}
                    aria-pressed={matrixFastTier.active}
                    title={matrixFastTier.description ?? matrixFastTier.label}
                    onclick={() => void onSelectServiceTier(matrixFastTier.active ? 'default' : matrixFastTier.id)}
                  >
                    <Icon name="bolt" size={15} />
                    {matrixFastTier.label}
                  </Button>
                {/if}
                <ModelContextSelect
                  options={modelCatalog?.current?.contextWindows ?? []}
                  current={modelCatalog?.currentContextWindow ?? null}
                  disabled={matrixDisabled || modelCatalogLoading || !sessionCapabilities.includes('model.context-window')}
                  onSelect={(id) => { if (modelCatalog?.current) void onSelectContextWindow(id, modelCatalog.current.reference); }}
                />
                </div>
              </div>
              {#if sessionRunning}
                <div class="composer-menu-detail">会话运行中，模型与推理强度暂不可修改。</div>
              {/if}
              {#if modelCatalogLoading}
                <div class="composer-suggestions-empty">正在读取可用模型…</div>
              {:else if modelCatalog && modelCatalog.models.length > 0}
                <ModelMatrix
                  columns={matrixReasoningOptions}
                  rows={matrixRows}
                  defaultLabel={matrixDefaultLabel}
                  defaultTitle={modelConfiguration.defaultAction === 'reset' ? '使用该模型的默认推理强度' : '切换模型，保留当前推理强度'}
                  fastTier={null}
                  disabled={matrixDisabled}
                  onSelect={(model, reasoningEffort) => {
                    modelMenuOpen = false;
                    void onSelectModelConfiguration(model, reasoningEffort);
                  }}
                  onSelectServiceTier={(serviceTier) => void onSelectServiceTier(serviceTier)}
                />
              {:else if sessionRunning}
                <div class="composer-suggestions-empty">尚无已确认的模型配置，回合结束后将自动读取。</div>
              {:else}
                <div class="composer-suggestions-empty">未获取到可用模型，请稍后重试。</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if sessionRunning}
        {#if sessionCapabilities.includes('queue.manage')}
          {#if sessionCapabilities.includes('queue.steer')}
            <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || !text.trim()}>立即发送</Button>
          {/if}
          <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || !text.trim()}>排队发送</Button>
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

<style>
  .composer-model-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-right: 8px;
  }

  .composer-model-options {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .composer-model-header-labels {
    min-width: 0;
  }
</style>
