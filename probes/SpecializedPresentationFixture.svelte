<script lang="ts">
  import { onMount } from 'svelte';
  import Surface from '../src/lib/workbench/PresentationSurface.svelte';
  import { setUiKit } from '../src/lib/ui-kit/registry';
  import source from '../fixtures/semantic-git/detail.json';
  let snapshot = $state({...structuredClone(source), schema:'aibo.semantic-view/v1.1', actions:[...source.actions, {id:'dev.probe.write',label:'写入样例',intent:'execute',enabled:true,input:{value:'frozen'}}, {id:'dev.probe.disabled',label:'不可用动作',intent:'execute',enabled:false,input:{}}]});
  let preference = $state(undefined);
  let actions = [];
  onMount(() => {
    window.specializedProbe = {
      kit: id => setUiKit(id),
      core: () => { preference = null; },
      specialized: () => { preference = { id:'dev.aibo.ui-default.numbered-detail', version:'1.0.0' }; },
      incompatible: () => { preference = { id:'dev.aibo.ui-default.numbered-detail', version:'2.0.0' }; },
      large: () => { snapshot = { ...snapshot, context: {...snapshot.context,revision:snapshot.context.revision+1}, view: {...snapshot.view,content:'full line\n'.repeat(6000)} }; },
      snapshot: () => $state.snapshot(snapshot),
      actions: () => actions,
    };
    return () => { delete window.specializedProbe; };
  });
</script>
<Surface {snapshot} {preference} layout="central" onAction={action => actions.push(action)} />
