<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { AttachmentList } from '$lib/ui-kit';
  import { clipboardImageFiles } from '$lib/app/clipboard-images';
  import { tick } from 'svelte';
  import { sessionControlOptions, selectedSessionControls } from '$lib/app/session-access-profile';
  import { commandComposerInsertion } from '$lib/app/agent-commands';
  import { sessionAgentKind } from '$lib/app/agent-kind';
  import { filterMentionSuggestions, type MentionCategory } from '$lib/app/mention-suggestions';
  import { reasoningEffortLabel, type ModelConfigurationState } from '$lib/app/model-configuration';
  import { AgentStatusMark, Button, Card, Icon, ModelContextSelect, ModelMatrix, Select, SessionControlMark, Textarea } from '$lib/ui-kit';
  import type { UiModelMatrixRow } from '$lib/ui-kit';
  import type { AgentCommand, AgentCommandCategory, ContextAttachment, SessionControlId, SessionExecutionProfile, SessionModelCatalog, Session, WorkspacePathSuggestion } from '$lib/types';
  import { scrollActiveOptionIntoView } from './active-option-scroll';
  import { formatBytes } from './session-utils';

  type SlashCategory = 'all' | AgentCommandCategory;

  type ComposerProps = {
    selectedAgent: 'codex' | 'pi' | null;
    selectedSession: boolean;
    sessionCapabilities: string[];
    selectedSessionId: string | null;
    sessionArchived: boolean;
    historyOnly?: boolean;
    sessionRunning: boolean;
    sessionStarting?: boolean;
    selectedSessionArchiving: boolean;
    busy: boolean;
    attachments: ContextAttachment[];
    attachmentPreviews?: Record<string, string | null>;
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
    onPasteImages: (files: File[]) => void;
    onAddDirectory: () => void;
    onRemoveAttachment: (id: string) => void;
    onSend: () => void;
    onQueue: (mode: 'steer' | 'followUp') => void;
    onAbort: () => void;
    onSelectAccess: (mode: SessionControlId) => void | Promise<void>;
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
    historyOnly = false,
    sessionRunning,
    sessionStarting = false,
    selectedSessionArchiving,
    busy,
    attachments, attachmentPreviews = {},
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
    onAddAttachments, onPasteImages,
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
  const hasImage = $derived(pendingAttachments.some(item => item.mediaType.startsWith('image/') && item.sendStrategy === 'inline'));

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
  let mentionLayer = $state<HTMLDivElement | null>(null);
  // Same token shape the mention picker inserts: "@" + path up to the next whitespace.
  const mentionSegments = $derived.by(() => {
    const segments: { text: string; mention: boolean }[] = [];
    let last = 0;
    for (const match of text.matchAll(/(?<=^|\s)@\S+/g)) {
      if (match.index > last) segments.push({ text: text.slice(last, match.index), mention: false });
      segments.push({ text: match[0], mention: true });
      last = match.index + match[0].length;
    }
    if (last < text.length) segments.push({ text: text.slice(last), mention: false });
    return segments;
  });
  // A pending attachment that the draft already @-mentions shows only as its inline tag;
  // removing the tag brings its chip back, so attached context always has a visible handle.
  const mentionedPaths = $derived(new Set(mentionSegments.filter(segment => segment.mention).map(segment => segment.text.slice(1))));
  const visibleAttachments = $derived(pendingAttachments.filter(attachment => !mentionedPaths.has(attachment.path)));
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
      });
  });
  const slashCategories: Array<{ id: SlashCategory; label: string }> = $derived([
    { id: 'all', label: $t('composer.category.all') },
    { id: 'agent', label: $t('composer.category.agent') },
    { id: 'skill', label: $t('composer.category.skill') },
    { id: 'extension', label: $t('composer.category.extension') },
  ]);
  const mentionCategories: Array<{ id: MentionCategory; label: string }> = $derived([
    { id: 'all', label: $t('composer.category.all') },
    { id: 'files', label: $t('composer.category.files') },
    { id: 'folders', label: $t('composer.category.folders') },
    { id: 'sessions', label: $t('composer.category.sessions') },
  ]);
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
  const accessOptions = $derived(sessionControlOptions(executionProfile, selectedSession ? selectedSessionId : null));
  const selectedControls = $derived(selectedSessionControls(accessOptions, activeProfile));
  const accessLabel = $derived(selectedControls.map(option => option.label).join(' · ') || $t('composer.sessionSettings'));
  const accessDetail = $derived(selectedControls.map(option => option.description).join(' · '));
  const accessGroups = $derived(['permission', 'mode'].map(kind => ({
    kind, label: kind === 'permission' ? $t('composer.permission') : $t('composer.mode'), options: accessOptions.filter(option => option.kind === kind),
  })).filter(group => group.options.length));
  const modelLabel = $derived(
    modelOverride || modelCatalog?.current?.label || activeProfile?.model || (modelCatalogLoading ? $t('composer.loadingModel') : $t('composer.defaultModel')),
  );
  const currentReasoningEffort = $derived(modelConfiguration.currentReasoningEffort);
  const currentEffortLabel = $derived(reasoningEffortLabel(modelCatalog, currentReasoningEffort));
  const reasoningLabel = $derived(currentEffortLabel ? ` · ${currentEffortLabel}` : '');
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
  const matrixDefaultLabel = $derived(modelConfiguration.defaultAction === 'reset' ? $t('composer.default') : $t('composer.keep'));
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
  const matrixDisabled = $derived(busy || sessionStarting || sessionArchived || historyOnly || selectedSessionArchiving || sessionRunning);
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
    text = text.replace(/^\/([^\s]*)$/, commandComposerInsertion(command));
    slashActiveIndex = -1;
    onComposerInput(text);
  }

  function showSessionMenu(menu: HTMLDivElement) {
    const trigger = menu.parentElement?.querySelector<HTMLButtonElement>('.composer-access-control');
    if (!trigger) return;
    const close = () => { sessionMenuOpen = false; };
    const position = () => {
      const anchor = trigger.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
      const above = anchor.top - bounds.height - 8;
      const below = anchor.bottom + 8;
      menu.style.top = `${Math.max(8, Math.min(above >= 8 ? above : below, innerHeight - bounds.height - 8))}px`;
    };
    const onToggle = (event: ToggleEvent) => { if (event.newState === 'closed') close(); };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.contains(event.target)) return;
      position();
    };
    menu.addEventListener('toggle', onToggle);
    menu.showPopover();
    position();
    const initialOption = menu.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
      ?? menu.querySelector<HTMLButtonElement>('button:not(:disabled)');
    initialOption?.focus({ preventScroll: true });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return { destroy() {
      menu.removeEventListener('toggle', onToggle);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
      if (menu.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    } };
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
    {#if visibleAttachments.length > 0}
      <AttachmentList items={visibleAttachments.map(item => ({ ...item, sizeLabel: formatBytes(item.size) }))} previews={attachmentPreviews} onRemove={onRemoveAttachment} disabled={busy} />
    {/if}
    <div class="composer-input-stack">
    <!-- Mirror of the text with @references as tags; the textarea above it keeps input, caret and selection. -->
    <div class="composer-mention-layer" aria-hidden="true" bind:this={mentionLayer}>{#each mentionSegments as segment, index (index)}{#if segment.mention}<mark class="composer-mention">{segment.text}</mark>{:else}{segment.text}{/if}{/each}{'\n'}</div>
    <Textarea data-presentation-focus="composer"
      class="composer-textarea"
      onscroll={(event) => { if (mentionLayer) mentionLayer.scrollTop = (event.currentTarget as HTMLTextAreaElement).scrollTop; }}
      data-composer-input="true"
      bind:value={text}
      rows="2"
      placeholder={historyOnly ? $t('composer.historyOnly') : sessionStarting ? $t('composer.starting') : sessionArchived ? $t('composer.archived') : selectedSession ? $t('composer.placeholder') : $t('composer.noSession')}
      disabled={!selectedSession || sessionArchived || historyOnly || selectedSessionArchiving || (sessionRunning && !sessionCapabilities.includes('queue.manage')) || busy}
      onpaste={(event) => {
        const files = clipboardImageFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        onPasteImages(files);
      }}
      onkeydown={(event) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey)) {
          if (event.ctrlKey) {
            event.preventDefault();
            if (!document.execCommand('insertText', false, '\n')) {
              const input = event.currentTarget as HTMLTextAreaElement;
              input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
              updateComposerInput(input.value);
            }
          }
          return;
        }
        if (event.key === 'Enter' && (event.repeat || event.altKey)) return;
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
        if (event.key === 'Enter') {
          event.preventDefault();
          if (sessionRunning && sessionCapabilities.includes('queue.manage')) onQueue('followUp');
          else onSend();
        }
      }}
      oninput={(event) => updateComposerInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></Textarea>
    </div>
    {#if showMentionSuggestions && mentionActiveIndex >= 0}
      <div class="composer-suggestions" role="group" aria-label={$t('composer.references')}>
        <div class="composer-command-categories" role="tablist" aria-label={$t('composer.referenceCategories')}>
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
        <div bind:this={suggestionList} class="composer-suggestion-options" role="listbox" aria-label={$t('composer.referenceSuggestions')}>
          {#if mentionSuggestions.length === 0}
            <div class="composer-suggestions-empty">{$t('composer.noReferences')}</div>
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
                <AgentStatusMark agent={sessionAgentKind(suggestion.session)} icon={sessionIcons[suggestion.session.id]} tone="idle" label={$t('composer.agentSession', { agent: suggestion.session.agent })} />
              {:else}
                <Icon name={suggestion.kind === 'folder' ? 'folder' : 'file'} size={13} />
              {/if}
              <span>{suggestion.kind === 'session' ? suggestion.session.label : suggestion.path.path}</span>
              <small>{suggestion.kind === 'session' ? $t('composer.sessionReference', { agent: suggestion.session.agent, archived: suggestion.session.archived ? $t('composer.archivedSuffix') : '' }) : suggestion.kind === 'folder' ? $t('composer.folder') : $t('composer.file')}</small>
            </button>
          {/each}
        </div>
      </div>
    {:else if showSlashMenu}
      <div class="composer-suggestions" role="group" aria-label={$t('composer.commands')}>
        <div class="composer-command-categories" role="tablist" aria-label={$t('composer.commandCategories')}>
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
        <div bind:this={suggestionList} class="composer-suggestion-options" role="listbox" aria-label={$t('composer.commandSuggestions')}>
          {#if agentCommandsLoading && filteredAgentCommands.length === 0}
            <div class="composer-suggestions-empty">{$t('composer.loadingCommands')}</div>
          {:else if filteredAgentCommands.length === 0}
            <div class="composer-suggestions-empty">
              {agentCommands.length === 0 ? $t('composer.noCommands') : $t('composer.noMatchingCommands')}
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
          disabled={!selectedSession || sessionArchived || historyOnly || selectedSessionArchiving || busy}
          aria-label={$t('composer.addContext')}
          aria-haspopup="menu"
          aria-expanded={attachmentMenuOpen}
          title={$t('composer.addContext')}
        >
          <Icon name="add" size={20} />
        </Button>
        {#if attachmentMenuOpen}
          <div class="composer-menu composer-attachment-menu" role="menu" aria-label={$t('composer.addContext')}>
            <button type="button" role="menuitem" onclick={() => { attachmentMenuOpen = false; onAddAttachments(); }}>
              <Icon name="folder-add" size={15} />
              <span>{$t('composer.addFile')}</span>
            </button>
            <button type="button" role="menuitem" onclick={() => { attachmentMenuOpen = false; onAddDirectory(); }}>
              <Icon name="folder" size={15} />
              <span>{$t('composer.addFolder')}</span>
            </button>
          </div>
        {/if}
      </div>

      {#if selectedSession && accessOptions.length}
        <div class="composer-menu-anchor">
          <Button
            variant="toolbar"
            type="button"
            class="composer-toolbar-control composer-access-control"
            onclick={() => { sessionMenuOpen = !sessionMenuOpen; attachmentMenuOpen = false; modelMenuOpen = false; }}
            aria-haspopup="menu"
            aria-expanded={sessionMenuOpen}
            title={accessDetail}
            aria-label={accessLabel}
          >
            {#each selectedControls as option, index (option.id)}
              {#if index > 0}<span class="composer-access-divider" aria-hidden="true">·</span>{/if}
              <span class="composer-access-selection"><SessionControlMark control={option} compact /><span>{option.label}</span></span>
            {:else}
              <Icon name="settings" size={16} /><span>{accessLabel}</span>
            {/each}
          </Button>
          {#if sessionMenuOpen}
            <div use:showSessionMenu popover="auto" class="composer-menu composer-profile-menu" role="menu" aria-label={$t('composer.sessionSettings')}>
              <div class="composer-menu-heading">{$t('composer.sessionSettings')}</div>
              <div class="composer-menu-detail">{accessDetail}</div>
              {#each accessGroups as group (group.kind)}
              <div class="composer-menu-heading">{group.label}</div>
              <div class="composer-access-options" role="group" aria-label={group.label}>
                {#each group.options as option (option.id)}
                  {@const active = selectedControls.some(selected => selected.id === option.id)}
                  <button
                    class:active={active}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onclick={() => {
                      sessionMenuOpen = false;
                      if (!active) void onSelectAccess(option.id);
                    }}
                    disabled={busy || historyOnly || sessionStarting || selectedSessionArchiving || sessionRunning}
                  >
                    <SessionControlMark control={option} />
                    <span class="composer-access-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {#if active}<Icon name="check" size={14} />{/if}
                  </button>
                {/each}
              </div>
              {/each}
              {#if executionProfile?.unsupported && executionProfile.unsupported.length > 0}
                <div class="composer-menu-warning">{$t('composer.unsupported', { features: executionProfile.unsupported.join(', ') })}</div>
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
            title={`${modelLabel}${reasoningLabel}${matrixFastTier?.active ? $t('composer.fastEnabled') : ''}`}
            aria-label={`${modelLabel}${reasoningLabel}${matrixFastTier?.active ? $t('composer.fastEnabledAria') : ''}`}
          >
            {#if matrixFastTier?.active}
              <Icon name="bolt" size={15} />
            {/if}
            <span class="composer-model-label">{modelLabel}{reasoningLabel}</span>
            <Icon name="chevron-down" size={15} />
          </Button>
          {#if modelMenuOpen}
            <div class="composer-menu composer-model-menu" role="menu" aria-label={$t('composer.modelSettings')}>
              <div class="composer-model-header">
                <div class="composer-model-header-labels">
                  <div class="composer-menu-heading">{$t('composer.modelReasoning')}</div>
                  <div class="composer-menu-detail">{$t('composer.currentModel', { model: modelLabel, reasoning: reasoningLabel })}</div>
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
                {#if sessionCapabilities.includes('model.context-window') && (modelCatalog?.current?.contextWindows?.length ?? 0) > 0}
                  <!-- Without a declared capability or choices, there is nothing to select; hide instead of showing a dead control. -->
                  <ModelContextSelect
                    options={modelCatalog?.current?.contextWindows ?? []}
                    current={modelCatalog?.currentContextWindow ?? null}
                    disabled={matrixDisabled || modelCatalogLoading}
                    onSelect={(id) => { if (modelCatalog?.current) void onSelectContextWindow(id, modelCatalog.current.reference); }}
                  />
                {/if}
                </div>
              </div>
              {#if sessionRunning}
                <div class="composer-menu-detail">{$t('composer.modelBusy')}</div>
              {/if}
              {#if modelCatalogLoading}
                <div class="composer-suggestions-empty">{modelCatalog ? $t('composer.updatingModel') : $t('composer.loadingModels')}</div>
              {/if}
              {#if modelCatalog && modelCatalog.models.length > 0}
                {#if modelCatalog.parameterScope === 'current-model'}
                  <div class="composer-model-selectors">
                    <Select
                      aria-label={$t('composer.model')}
                      options={modelCatalog.models.map(model => ({ value: model.reference, label: model.label }))}
                      value={modelCatalog.current?.reference ?? ''}
                      placeholder={$t('composer.selectModel')}
                      disabled={matrixDisabled || modelCatalogLoading || !sessionCapabilities.includes('model.select')}
                      onSelect={(model) => void onSelectModelConfiguration(model, null)}
                    />
                    <Select
                      aria-label={$t('composer.reasoning')}
                      options={reasoningOptions.map(option => ({ value: option.id, label: option.label }))}
                      value={selectedReasoningEffort ?? ''}
                      placeholder={modelCatalogLoading || busy ? $t('composer.updating') : reasoningOptions.length ? $t('composer.selectReasoning') : $t('composer.noReasoning')}
                      disabled={matrixDisabled || modelCatalogLoading || !modelCatalog.current || !reasoningOptions.length || !sessionCapabilities.includes('model.reasoning')}
                      onSelect={(effort) => { if (modelCatalog?.current) void onSelectModelConfiguration(modelCatalog.current.reference, effort); }}
                    />
                  </div>
                {:else}
                <ModelMatrix
                  columns={matrixReasoningOptions}
                  rows={matrixRows}
                  defaultLabel={matrixDefaultLabel}
                  defaultTitle={modelConfiguration.defaultAction === 'reset' ? $t('composer.defaultReasoning') : $t('composer.keepReasoning')}
                  fastTier={null}
                  disabled={matrixDisabled || modelCatalogLoading}
                  onSelect={(model, reasoningEffort) => {
                    modelMenuOpen = false;
                    void onSelectModelConfiguration(model, reasoningEffort);
                  }}
                  onSelectServiceTier={(serviceTier) => void onSelectServiceTier(serviceTier)}
                />
                {/if}
              {:else if sessionRunning}
                <div class="composer-suggestions-empty">{$t('composer.noConfirmedModel')}</div>
              {:else if !modelCatalogLoading}
                <div class="composer-suggestions-empty">{$t('composer.noModels')}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if sessionRunning}
        {#if sessionCapabilities.includes('queue.manage')}
          {#if sessionCapabilities.includes('queue.steer')}
            <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('steer')} disabled={busy || (!text.trim() && !hasImage)}>{$t('composer.sendNow')}</Button>
          {/if}
          <Button variant="queue" class="composer-action composer-action-queue" size="sm" type="button" onclick={() => onQueue('followUp')} disabled={busy || (!text.trim() && !hasImage)}>{$t('composer.queue')}</Button>
        {/if}
        <Button variant="abort" class="composer-action composer-action-abort" size="icon" type="button" onclick={onAbort} disabled={busy} aria-label={$t('composer.abort')}>
          <Icon name="stop" size={13} />
        </Button>
      {:else}
        <Button variant="send" class="composer-action composer-action-send" size="icon" type="submit" disabled={!selectedSession || sessionStarting || sessionArchived || historyOnly || selectedSessionArchiving || (!text.trim() && !hasImage) || busy} aria-label={$t('composer.send')}>
          <Icon name="send" size={16} />
        </Button>
      {/if}
    </div>
  </div>
</Card>

<style>
  /* Layer and textarea share one grid cell so the mirror always has the textarea's box. */
  .composer-input-stack {
    display: grid;
    min-width: 0;
  }

  .composer-input-stack > :global(*) {
    grid-area: 1 / 1;
    min-width: 0;
  }

  .composer-mention-layer {
    overflow: hidden;
    pointer-events: none;
  }

  .composer-input-stack > :global(.composer-textarea) {
    position: relative;
    z-index: 1;
  }

  .composer-model-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-right: 8px;
  }

  .composer-model-selectors {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 12px;
    padding: 8px;
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
