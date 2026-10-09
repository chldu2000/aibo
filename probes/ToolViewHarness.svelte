<script>
  import { onMount } from 'svelte';
  import ToolView from '../src/lib/components/app/ToolView.svelte';
  let revision = $state(0);
  onMount(() => { const timer = setInterval(() => revision++, 50); return () => clearInterval(timer); });
</script>
<ToolView title={`Terminal ${revision}`} open={() => { void revision; return Promise.resolve({id:'probe',url:'/terminal-document'}); }} request={(_,payload)=>window.toolNativeRequest(payload)} />
