<script lang="ts">
  import View from './SemanticView.svelte';
  import type { PresentationProps } from '../../presentation-props';
  let props: PresentationProps = $props();
</script>
<div class="semantic-skin"><View {...props} /></div>
