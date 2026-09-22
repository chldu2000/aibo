<script lang="ts">
  import { Button } from '$lib/ui-kit';
  import type { WorkspacePreferencesState } from '$lib/app/workspace-preferences-controller';
  let { state, desktop, onChange, onReload }: {
    state: WorkspacePreferencesState;
    desktop: boolean;
    onChange: (trusted: boolean) => void;
    onReload: () => void;
  } = $props();
</script>

<section class="settings-section" aria-labelledby="workspace-preferences-title" aria-busy={state.loading || state.saving}>
  <div class="settings-section-heading"><div><h2 id="workspace-preferences-title">工作区</h2><p>仅影响之后新增的工作区，不改变已有目录的信任状态。</p></div></div>
  <label class="workspace-preference-option">
    <span><strong>新增工作区默认信任</strong><small id="workspace-trust-default-description">关闭后，新增工作区需手动标记为可信。单个工作区可在“更多”中调整。</small></span>
    <input type="checkbox" role="switch" aria-label="新增工作区默认信任" aria-describedby="workspace-trust-default-description"
      checked={state.value?.trustNewWorkspaces ?? false}
      disabled={!desktop || !state.value || state.loading || state.saving}
      onchange={event => {
        const trusted = event.currentTarget.checked;
        event.currentTarget.checked = state.value?.trustNewWorkspaces ?? false;
        onChange(trusted);
      }} />
  </label>
  {#if !desktop}<p class="workspace-preference-status">请在桌面应用中调整此设置。</p>
  {:else if state.loading || state.saving}<p class="workspace-preference-status" role="status">{state.saving ? '正在保存…' : '正在读取…'}</p>{/if}
  {#if state.error}<div class="workspace-preference-status"><p role="alert">{state.error}</p><Button variant="ghost" size="sm" onclick={onReload} disabled={state.loading || state.saving}>重新读取设置</Button></div>{/if}
</section>
