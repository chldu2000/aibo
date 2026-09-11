<script lang="ts">
  import { setUiKit } from '$lib/ui-kit/registry';
  import { onMount } from 'svelte';
  import { WorkbenchPresentation, Button, Textarea, PluginView } from '$lib/ui-kit';
  let surface;
  let interaction = $state({ fields: {}, expanded: {} });
  const document = {schema:'aibo.plugin-view/v1',viewId:'test.form',revision:1,title:'Test Form',data:{},bindings:[],actions:[],resources:[],root:{id:'field',type:'form-field',props:{fieldId:'draft',label:'插件草稿',value:''},children:[]}};
  let draft = $state('KEEP_DRAFT');
  let sessionId = $state('a');
  let chunks = $state(0);
  let oldAction;
  let actions = $state(0);
  onMount(() => {
    const timer = setInterval(() => { chunks++; }, 10);
    window.lifecycleProbe = {
      kit: id => setUiKit(id),
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
      <Textarea data-presentation-focus="draft" aria-label="草稿" value={draft} oninput={guard('draft.change', event => { draft = event.currentTarget.value; })} />
      <Button onclick={() => { oldAction = action; }}>捕获旧回调</Button>
      <Button onclick={action}>执行动作</Button>
      <PluginView {document} {sessionId} {interaction} onInteractionChange={guard('plugin.form', value => { interaction = value; })} onAction={() => {}} />
      <p aria-label="stream">{chunks}</p>
    </section>
  {/snippet}
</WorkbenchPresentation>
