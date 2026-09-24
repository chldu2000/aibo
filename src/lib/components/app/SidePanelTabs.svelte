<script lang="ts">
  import { tick } from 'svelte';
  import { Badge, Button, Icon } from '$lib/ui-kit';
  import type { SidePanelView } from './view-types';

  type SidePanelTabsProps = {
    activeView: SidePanelView;
    gitCount?: number;
    onSelect: (view: SidePanelView) => void;
  };

  let { activeView, gitCount, onSelect }: SidePanelTabsProps = $props();

  const views: readonly SidePanelView[] = ['git', 'context'];

  // Each panel mounts its own tab list, so the selected tab is a new element.
  // Focus it as soon as Svelte has applied the switch, before the next frame.
  async function focusView(view: SidePanelView): Promise<void> {
    await tick();
    document.getElementById(`side-panel-tab-${view}`)?.focus();
  }

  function moveTab(event: KeyboardEvent): void {
    const currentIndex = views.indexOf(activeView);
    let nextView: SidePanelView | undefined;
    if (event.key === 'ArrowLeft') nextView = views[(currentIndex - 1 + views.length) % views.length];
    if (event.key === 'ArrowRight') nextView = views[(currentIndex + 1) % views.length];
    if (event.key === 'Home') nextView = views[0];
    if (event.key === 'End') nextView = views[views.length - 1];
    if (!nextView) return;
    event.preventDefault();
    onSelect(nextView);
    void focusView(nextView);
  }
</script>

<div class="side-panel-tabs-shell">
  <div class="side-panel-tabs" aria-label="侧边栏视图" role="tablist">
    <Button
      variant="ghost"
      size="sm"
      type="button"
      role="tab"
      id="side-panel-tab-git"
      aria-label="Git"
      aria-controls="side-panel-content-git"
      aria-selected={activeView === 'git'}
      tabindex={activeView === 'git' ? 0 : -1}
      onkeydown={moveTab}
      onclick={() => onSelect('git')}
    >
      <Icon name="branch" size={13} data-icon="inline-start" />
      Git {#if gitCount !== undefined}<Badge variant="secondary">{gitCount}</Badge>{/if}
    </Button>
    <Button
      variant="ghost"
      size="sm"
      type="button"
      role="tab"
      id="side-panel-tab-context"
      aria-controls="side-panel-content-context"
      aria-selected={activeView === 'context'}
      tabindex={activeView === 'context' ? 0 : -1}
      onkeydown={moveTab}
      onclick={() => onSelect('context')}
    >
      <Icon name="file" size={13} data-icon="inline-start" />
      上下文
    </Button>
  </div>
</div>
