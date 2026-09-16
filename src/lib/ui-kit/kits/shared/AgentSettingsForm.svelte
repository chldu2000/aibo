<script lang="ts">
  import Button from '../../runtime/Button.svelte';
  import Input from '../../runtime/Input.svelte';
  import Textarea from '../../runtime/Textarea.svelte';
  import Label from '../../runtime/Label.svelte';
  import type { UiAgentSettingsFormProps } from '../../contract';
  let { snapshot, draft, busy, error, notice, onChange, onSave, onReset, onReload }: UiAgentSettingsFormProps = $props();
  const id = $props.id();
</script>
<form class="agent-settings-form" onsubmit={(event) => { event.preventDefault(); if (!busy) onSave(); }} aria-busy={busy}>
  <header><h3>{snapshot.descriptor.title}</h3>{#if snapshot.descriptor.description}<p>{snapshot.descriptor.description}</p>{/if}</header>
  {#each snapshot.descriptor.fields as field (field.key)}
    {@const value = draft[field.key] ?? snapshot.inheritedValues[field.key]}
    <div class="agent-settings-field">
      <Label for={`${id}-${field.key}`}>{field.label}</Label>
      {#if field.description}<p id={`${id}-${field.key}-help`}>{field.description}</p>{/if}
      {#if field.type === 'boolean'}
        <input id={`${id}-${field.key}`} type="checkbox" checked={value === true} disabled={busy} aria-describedby={field.description ? `${id}-${field.key}-help` : undefined} onchange={(event) => onChange(field.key, event.currentTarget.checked)} />
      {:else if field.type === 'select'}
        <select id={`${id}-${field.key}`} value={String(value)} disabled={busy} aria-describedby={field.description ? `${id}-${field.key}-help` : undefined} onchange={(event) => onChange(field.key, event.currentTarget.value)}>
          {#each field.options ?? [] as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
        </select>
      {:else if field.type === 'multiline'}
        <Textarea id={`${id}-${field.key}`} value={String(value)} rows={5} disabled={busy} aria-describedby={field.description ? `${id}-${field.key}-help` : undefined} oninput={(event: Event) => onChange(field.key, (event.currentTarget as HTMLTextAreaElement).value)} />
      {:else}
        <Input id={`${id}-${field.key}`} type={field.type === 'number' ? 'number' : 'text'} step="any" min={field.min} max={field.max} value={String(value)} disabled={busy} aria-describedby={field.description ? `${id}-${field.key}-help` : undefined} oninput={(event: Event) => { const text = (event.currentTarget as HTMLInputElement).value; onChange(field.key, field.type === 'number' && text !== '' ? Number(text) : text); }} />
      {/if}
      <div class="agent-settings-inheritance"><small>{Object.hasOwn(draft, field.key) ? '已在此范围覆盖' : '使用继承值或默认值'}</small><Button type="button" size="sm" variant="ghost" disabled={busy || !Object.hasOwn(draft, field.key)} onclick={() => onChange(field.key, undefined)}>使用继承值</Button></div>
    </div>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  <footer><Button type="submit" disabled={busy}>保存设置</Button><Button type="button" variant="outline" disabled={busy} onclick={onReset}>全部使用继承值</Button><Button type="button" variant="ghost" disabled={busy} onclick={onReload}>重新加载并丢弃修改</Button></footer>
</form>
