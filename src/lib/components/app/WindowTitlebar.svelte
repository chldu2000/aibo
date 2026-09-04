<script lang="ts">
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import { Button } from '$lib/ui-kit';

  type WindowTitlebarProps = {
    onOpenSettings: () => void;
  };

  let { onOpenSettings }: WindowTitlebarProps = $props();
</script>

<header class="window-titlebar" data-tauri-drag-region data-ui-component="window-titlebar">
  <span class="window-title">Aibo</span>
  <div class="window-actions">
    <Button variant="ghost" size="icon" type="button" aria-label="打开设置" title="设置" onclick={onOpenSettings}>
      <SettingsIcon size={15} />
    </Button>
  </div>
</header>
