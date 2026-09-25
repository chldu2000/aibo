<script lang="ts">
  import type { UiColumnSplitterProps } from '../../contract';

  let { label, width, onPointerDown, onKeyDown }: UiColumnSplitterProps = $props();
</script>

<button
  type="button"
  class="workspace-splitter"
  aria-label={`${label}，当前 ${width} 像素`}
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
>
  <span class="workspace-splitter-line" aria-hidden="true"></span>
</button>
