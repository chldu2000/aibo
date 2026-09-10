<script lang="ts">
  import View from '../shared/SemanticView.svelte';
  import type { PresentationProps } from '../../presentation-props';
  let props: PresentationProps = $props();
</script>
<div class="semantic-skin"><View {...props} /></div>
<style>
  .semantic-skin { --semantic-radius: 0.5rem; height: 100%; min-height: 0; }
</style>
