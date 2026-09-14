<script lang="ts">
  import View from '../shared/SemanticView.svelte';
  import type { PresentationProps } from '../../presentation-props';
  let props: PresentationProps = $props();
</script>
<div class="semantic-skin"><View {...props} /></div>
<style>
  .semantic-skin { --semantic-radius: 1.25rem; height: 100%; min-height: 0; }
</style>
