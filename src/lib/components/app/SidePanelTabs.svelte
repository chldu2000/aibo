<script lang="ts">
  import { Button, Icon } from '$lib/ui-kit';
  import type { SidePanelView } from './view-types';

  type SidePanelTabsProps = {
    activeView: SidePanelView;
    onSelect: (view: SidePanelView) => void;
  };

  let { activeView, onSelect }: SidePanelTabsProps = $props();

  function moveTab(event: KeyboardEvent): void {
    event.preventDefault();
    const nextView: SidePanelView = activeView === 'context' ? 'git' : 'context';
    onSelect(nextView);
    requestAnimationFrame(() => document.getElementById(`side-panel-tab-${nextView}`)?.focus());
  }
</script>

<div class="side-panel-tabs" aria-label="侧边栏视图" role="tablist">
  <Button
    variant={activeView === 'context' ? 'secondary' : 'ghost'}
    size="sm"
    type="button"
    role="tab"
    id="side-panel-tab-context"
    aria-selected={activeView === 'context'}
    tabindex={activeView === 'context' ? 0 : -1}
    onkeydown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') moveTab(event);
    }}
    onclick={() => onSelect('context')}
  >
    <Icon name="file" size={13} />
    上下文
  </Button>
  <Button
    variant={activeView === 'git' ? 'secondary' : 'ghost'}
    size="sm"
    type="button"
    role="tab"
    id="side-panel-tab-git"
    aria-selected={activeView === 'git'}
    tabindex={activeView === 'git' ? 0 : -1}
    onkeydown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') moveTab(event);
    }}
    onclick={() => onSelect('git')}
  >
    <Icon name="branch" size={13} />
    Git
  </Button>
</div>
