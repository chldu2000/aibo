<script lang="ts">
  import { setUiKit } from '$lib/ui-kit/registry';
  import { onMount } from 'svelte';
  import { WorkbenchPresentation, Button, Textarea, Input } from '$lib/ui-kit';
  let surface;
  // Host-owned per-session state must survive replacement of the slot that edits it.
  let slotDrafts = $state<Record<string, string>>({});
  let draft = $state('KEEP_DRAFT');
  let draftDisabled = $state(false);
  let draftHidden = $state(false);
  let sessionId = $state('a');
  let chunks = $state(0);
  let oldAction;
  let actions = $state(0);
  onMount(() => {
    const timer = setInterval(() => { chunks++; }, 10);
    window.lifecycleProbe = {
      kit: id => setUiKit(id),
      draftAvailability: (disabled, hidden) => { draftDisabled = disabled; draftHidden = hidden; },
      switch: (layout, fail) => surface.switchPresentation(layout, fail),
      old: () => oldAction?.(),
      state: () => ({ draft, chunks, actions, sessionId }),
      select: id => { sessionId = id; },
    };
    return () => { clearInterval(timer); delete window.lifecycleProbe; };
  });
</script>
<WorkbenchPresentation bind:this={surface} windowId="lifecycle-probe" snapshot={{workspaceId:'w',sessionId,draft,navigation:null,timelineRevision:chunks}}>
  {#snippet navigation(guard)}<aside aria-label="槽位导航"><Button onclick={guard('navigation.test', () => {})}>导航</Button></aside>{/snippet}
  {#snippet auxiliary(guard)}<aside aria-label="槽位辅助"><Button onclick={guard('auxiliary.test', () => {})}>辅助</Button></aside>{/snippet}
  {#snippet overlays(guard)}<div aria-label="槽位浮层"><Button onclick={guard('overlay.test', () => {})}>浮层操作</Button></div>{/snippet}
  {#snippet content(guard)}
    {@const action = guard('test.action', () => { actions++; })}
    <section class="timeline">
      <Textarea disabled={draftDisabled} hidden={draftHidden} data-presentation-focus="draft" aria-label="草稿" value={draft} oninput={guard('draft.change', event => { draft = event.currentTarget.value; })} />
      <Button onclick={() => { oldAction = action; }}>捕获旧回调</Button>
      <Button onclick={action}>执行动作</Button>
      <label>槽位草稿<Input value={slotDrafts[sessionId] ?? ''} oninput={guard('slot.draft', event => { slotDrafts[sessionId] = event.currentTarget.value; })} /></label>
      <p aria-label="stream">{chunks}</p>
    </section>
  {/snippet}
</WorkbenchPresentation>
