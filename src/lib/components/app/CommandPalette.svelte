<script lang="ts">
  import { Button, Card, Icon, Input } from '$lib/ui-kit';
  import type { CommandPaletteCommand } from './command-palette';

  type CommandPaletteProps = {
    open: boolean;
    commands: CommandPaletteCommand[];
    onClose: () => void;
  };

  let { open, commands, onClose }: CommandPaletteProps = $props();
  let query = $state('');
  let activeIndex = $state(0);

  const filteredCommands = $derived.by(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.description ?? ''}`.toLocaleLowerCase().includes(normalized),
    );
  });

  $effect(() => {
    if (!open) return;
    query = '';
    activeIndex = 0;
  });

  $effect(() => {
    if (activeIndex >= filteredCommands.length) activeIndex = Math.max(0, filteredCommands.length - 1);
  });

  function close(): void {
    query = '';
    activeIndex = 0;
    onClose();
  }

  async function execute(command: CommandPaletteCommand): Promise<void> {
    if (command.disabled) return;
    close();
    await command.run();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = filteredCommands.length === 0 ? 0 : (activeIndex + 1) % filteredCommands.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = filteredCommands.length === 0
        ? 0
        : (activeIndex - 1 + filteredCommands.length) % filteredCommands.length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = filteredCommands[activeIndex];
      if (command) void execute(command);
    }
  }
</script>

{#if open}
  <div class="command-palette-overlay" role="presentation" onclick={close}>
    <Card
      class="command-palette"
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      onclick={(event) => event.stopPropagation()}
    >
      <div class="command-palette-search">
        <Icon name="search" size={15} />
        <Input
          id="command-palette-input"
          value={query}
          placeholder="搜索操作…"
          aria-label="搜索操作"
          autofocus
          oninput={(event) => { query = (event.currentTarget as HTMLInputElement).value; activeIndex = 0; }}
          onkeydown={handleKeydown}
        />
        <kbd>⌘K</kbd>
      </div>
      <div class="command-palette-heading">
        <strong id="command-palette-title">命令面板</strong>
        <Button variant="ghost" size="icon" type="button" aria-label="关闭命令面板" title="关闭" onclick={close}>
          <Icon name="close" size={14} />
        </Button>
      </div>
      <div class="command-palette-list" role="listbox" aria-label="可用操作">
        {#if filteredCommands.length === 0}
          <p class="command-palette-empty">没有匹配的操作。</p>
        {:else}
          {#each filteredCommands as command, index (command.id)}
            <button
              class:active={index === activeIndex}
              class:disabled={command.disabled}
              class="command-palette-command"
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              disabled={command.disabled}
              onclick={() => void execute(command)}
              onmouseenter={() => (activeIndex = index)}
            >
              <span class="command-palette-command-copy">
                <strong>{command.label}</strong>
                {#if command.description}<small>{command.description}</small>{/if}
              </span>
              {#if command.shortcut}<kbd>{command.shortcut}</kbd>{/if}
            </button>
          {/each}
        {/if}
      </div>
      <small class="command-palette-hint">↑↓ 选择 · Enter 执行 · Esc 关闭</small>
    </Card>
  </div>
{/if}
