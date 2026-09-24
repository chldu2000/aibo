<script lang="ts">
  import type { UiFileChangeMarkProps } from '../../contract';
  let { kind, decorative = false }: UiFileChangeMarkProps = $props();
  const states = {
    added: { symbol: 'A', label: '新增' },
    modified: { symbol: 'M', label: '修改' },
    deleted: { symbol: 'D', label: '删除' },
    renamed: { symbol: 'R', label: '重命名' },
    conflicted: { symbol: 'U', label: '合并冲突' },
  };
</script>

<span class="file-change-mark" data-kind={kind} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : states[kind].label} aria-hidden={decorative ? 'true' : undefined} title={states[kind].label}>{states[kind].symbol}</span>
