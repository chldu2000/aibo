<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import type { UiColumnSplitterProps } from '../../contract';

  let { label, width, onPointerDown, onKeyDown }: UiColumnSplitterProps = $props();
</script>

<button
  type="button"
  class="workspace-splitter"
  aria-label={$t('splitter.width', { label, width })}
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
>
  <span class="workspace-splitter-line" aria-hidden="true"></span>
</button>
