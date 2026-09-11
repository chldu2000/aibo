<script lang="ts">
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
      switch: (layout, fail) => surface.switchPresentation(layout, fail),
      old: () => oldAction?.(),
      state: () => ({ draft, chunks, actions, sessionId }),
      select: id => { sessionId = id; },
    };
    return () => { clearInterval(timer); delete window.lifecycleProbe; };
  });
</script>
<WorkbenchPresentation bind:this={surface} windowId="lifecycle-probe" snapshot={{workspaceId:'w',sessionId,draft,navigation:null,timelineRevision:chunks}}>
  {#snippet children(guard)}
    {@const action = guard('test.action', () => { actions++; })}
    <div class="workspace-grid"><section class="timeline">
      <Textarea data-presentation-focus="draft" aria-label="草稿" value={draft} oninput={guard('draft.change', event => { draft = event.currentTarget.value; })} />
      <Button onclick={() => { oldAction = action; }}>捕获旧回调</Button>
      <Button onclick={action}>执行动作</Button>
      <PluginView {document} {sessionId} {interaction} onInteractionChange={guard('plugin.form', value => { interaction = value; })} onAction={() => {}} />
      <p aria-label="stream">{chunks}</p>
    </section></div>
  {/snippet}
</WorkbenchPresentation>
