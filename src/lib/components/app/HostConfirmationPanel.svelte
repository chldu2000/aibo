<script lang="ts">
  import { Select, Button } from '$lib/ui-kit';
  import { hostConfirmationCategories, type HostConfirmationState, type HostConfirmationCategory, type HostConfirmationPolicy } from '$lib/app/host-confirmation-controller';
  let { state, desktop, onChange, onReload }: {
    state: HostConfirmationState;
    desktop: boolean;
    onChange: (category: HostConfirmationCategory, policy: HostConfirmationPolicy) => void;
    onReload: () => void;
  } = $props();
</script>

<section class="settings-section" aria-labelledby="host-confirmation-title" aria-busy={state.loading || state.saving}>
  <div class="settings-section-heading"><div><h2 id="host-confirmation-title">宿主操作确认</h2><p>适用于所有工作区，选择后自动保存。默认始终允许；选择“每次询问”后，执行前需确认。</p><p>工作区信任和插件权限仍然生效。Agent 会话中的权限审批由会话设置控制。</p></div></div>
  {#each hostConfirmationCategories as category (category.id)}
    <label class="workspace-preference-option">
      <span><strong>{category.label}</strong><small id={`host-confirmation-${category.id}-description`}>{category.description}</small></span>
      <Select aria-label={`${category.label}确认策略`} aria-describedby={`host-confirmation-${category.id}-description`}
        value={state.value?.[category.id] ?? ''} disabled={!desktop || !state.value || state.loading || state.saving}
        placeholder={desktop ? '未读取' : '桌面应用可用'}
        options={[{value:'always-allow',label:'始终允许'},{value:'ask',label:'每次询问'}]}
        onSelect={policy => { if (policy === 'always-allow' || policy === 'ask') onChange(category.id, policy); }} />
    </label>
  {/each}
  {#if !desktop}<p class="workspace-preference-status">请在桌面应用中调整此设置。</p>
  {:else if state.loading || state.saving}<p class="workspace-preference-status" role="status">{state.saving ? '正在保存…' : '正在读取…'}</p>{/if}
  {#if state.error}<div class="workspace-preference-status"><p role="alert">{state.error}</p><Button variant="ghost" size="sm" onclick={onReload} disabled={state.loading || state.saving}>重新读取确认设置</Button></div>{/if}
</section>
