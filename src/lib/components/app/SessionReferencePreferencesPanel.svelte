<script lang="ts">
  import { Button, Input, Select } from '$lib/ui-kit';
  import type { SessionReferencePreferencesState } from '$lib/app/session-reference-preferences-controller';
  let { state: preferences, desktop, onChange, onReload }: {
    state: SessionReferencePreferencesState;
    desktop: boolean;
    onChange: (messageLimit: number | null) => void;
    onReload: () => void;
  } = $props();
  let recentCount = $state('12');
  $effect(() => { if (preferences.value?.messageLimit != null) recentCount = String(preferences.value.messageLimit); });
  const disabled = $derived(!desktop || !preferences.value || preferences.loading || preferences.saving);
  const validCount = $derived(Number.isInteger(Number(recentCount)) && Number(recentCount) >= 1 && Number(recentCount) <= 10000);
</script>

<section class="settings-section" aria-labelledby="session-reference-preferences-title" aria-busy={preferences.loading || preferences.saving}>
  <div class="settings-section-heading"><div><h2 id="session-reference-preferences-title">会话引用</h2><p>适用于之后添加的会话引用，已添加或已发送的引用保持不变。</p></div></div>
  <label class="workspace-preference-option">
    <span><strong>传递消息范围</strong><small>用户与 Agent 消息合计计数，按原有顺序传递。工具输出、系统消息与嵌套引用不包含在内。</small></span>
    <Select aria-label="引用消息范围" value={preferences.value ? (preferences.value.messageLimit === null ? 'all' : 'recent') : ''}
      {disabled} placeholder="未读取" options={[{ value: 'all', label: '全部用户 / Agent 消息' }, { value: 'recent', label: '最近若干条消息' }]}
      onSelect={mode => onChange(mode === 'all' ? null : (validCount ? Number(recentCount) : 12))} />
  </label>
  {#if preferences.value && preferences.value.messageLimit !== null}
    <div class="reference-count">
      <label for="session-reference-count">最多传递条数</label>
      <div class="reference-count-controls">
      <Input id="session-reference-count" aria-label="最多传递条数" type="number" min="1" max="10000" step="1" value={recentCount}
        {disabled} oninput={event => { recentCount = String(event.currentTarget.value); }} />
      <Button size="sm" disabled={disabled || !validCount || Number(recentCount) === preferences.value.messageLimit} onclick={() => onChange(Number(recentCount))}>保存条数</Button>
      </div>
    </div>
  {/if}
  <p class="workspace-preference-status">保留所选消息正文。引用合计上限为 128 KiB；超限时请减少条数或引用数量。</p>
  {#if !desktop}<p class="workspace-preference-status">请在桌面应用中调整此设置。</p>
  {:else if preferences.loading || preferences.saving}<p class="workspace-preference-status" role="status">{preferences.saving ? '正在保存…' : '正在读取…'}</p>{/if}
  {#if preferences.error}<div class="workspace-preference-status"><p role="alert">{preferences.error}</p><Button variant="ghost" size="sm" onclick={onReload} disabled={preferences.loading || preferences.saving}>重新读取引用设置</Button></div>{/if}
</section>

<style>
  .reference-count { display: grid; gap: 8px; }
  .reference-count-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; max-width: 320px; }
</style>
