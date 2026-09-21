<script>
  let { model } = $props();
</script>

<main>
  <h2>Svelte presentation</h2>
  <p>{model.snapshot.data.conversation.session.label} · revision {model.snapshot.context.revision}</p>
  {#each model.snapshot.data.conversation.timeline as item (item.id)}
    <p>{item.content}</p>
  {/each}
  <label>草稿<textarea aria-label="草稿" value={model.snapshot.data.conversation.draft} oninput={event => model.request('draft', event.currentTarget.value)}></textarea></label>
  <button onclick={() => model.request('send')}>请求发送（由宿主确认）</button>
</main>
