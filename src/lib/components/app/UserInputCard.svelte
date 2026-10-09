<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { tick } from 'svelte';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '$lib/ui-kit';
  import { answeredRequest, userInputDraftKey } from '$lib/app/user-input-drafts';
  import type { UserInputRequest } from '$lib/types';

  let { request, drafts, busy, onDraftChange, onResolve, onCancel }: {
    request: UserInputRequest;
    drafts: Record<string, string>;
    busy: boolean;
    onDraftChange: (drafts: Record<string, string>) => void;
    onResolve: (request: UserInputRequest, answers: Record<string, string[]>) => void | Promise<void>;
    onCancel: (request: UserInputRequest) => void;
  } = $props();

  let selectedQuestionId = $state<string | null>(null);
  let attemptedSubmit = $state(false);
  let questionRegion: HTMLDivElement | undefined = $state();
  const questionIndex = $derived(Math.max(0, request.questions.findIndex(question => question.id === selectedQuestionId)));
  const question = $derived(request.questions[questionIndex]);
  const multiple = $derived(request.questions.length > 1);
  const missingAnswer = $derived(attemptedSubmit && question && !answer(question.id).trim());

  function answer(id: string): string {
    return drafts[userInputDraftKey(request, id)] ?? '';
  }

  function setAnswer(id: string, value: string): void {
    onDraftChange({ ...drafts, [userInputDraftKey(request, id)]: value });
  }

  async function selectQuestion(index: number): Promise<void> {
    const next = request.questions[index];
    if (!next) return;
    selectedQuestionId = next.id;
    await tick();
    if (questionRegion) {
      questionRegion.scrollTop = 0;
      questionRegion.focus({ preventScroll: true });
    }
  }

  async function submit(): Promise<void> {
    attemptedSubmit = true;
    const answers = answeredRequest(request, drafts);
    if (!answers) {
      await selectQuestion(request.questions.findIndex(item => !answer(item.id).trim()));
      return;
    }
    try { await onResolve(request, answers); } catch {
      // The host keeps drafts and reports a failed submission.
    }
  }
</script>

<Card class="user-input-card">
  <CardHeader class="user-input-card-heading">
    <CardTitle>{$t('input.title')}</CardTitle>
    <Badge variant="warning">{request.isBlocking ? $t('input.waiting') : $t('input.optional')}</Badge>
  </CardHeader>
  <CardContent class="user-input-card-content">
    {#if multiple}
      <div class="user-input-progress">
        <span aria-live="polite">{$t('input.progress', { current: questionIndex + 1, total: request.questions.length })}</span>
        <nav class="user-input-pages" aria-label={$t('input.navigation')}>
          {#each request.questions as item, index (item.id)}
            {@const answered = Boolean(answer(item.id).trim())}
            <Button type="button" size="sm" variant={index === questionIndex ? 'secondary' : 'ghost'}
              aria-current={index === questionIndex ? 'step' : undefined}
              aria-label={$t('input.questionStatus', { number: index + 1, status: answered ? $t('input.answered') : $t('input.unanswered') })}
              onclick={() => selectQuestion(index)}>{index + 1}{answered ? ' ✓' : ''}</Button>
          {/each}
        </nav>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable questions must be keyboard accessible.) -->
    <div class="user-input-details" role="region" aria-label={$t('input.current')} tabindex="0" bind:this={questionRegion}>
      {#if question}
        {#key question.id}
          <fieldset class="user-input-question">
            <legend>{question.header ?? $t('input.question')}</legend>
            <p>{question.question}</p>
            {#if missingAnswer}<p role="alert">{$t('input.missing')}</p>{/if}
            {#if question.options.length > 0}
              <div class="user-input-options">
                {#each question.options as option (option.label)}
                  <Button type="button" size="sm"
                    variant={answer(question.id) === option.label ? 'secondary' : 'outline'}
                    aria-pressed={answer(question.id) === option.label}
                    onclick={() => setAnswer(question.id, option.label)}>{option.label}</Button>
                {/each}
              </div>
            {/if}
            {#if question.options.length === 0 || question.isOther}
              <Input value={answer(question.id)}
                placeholder={question.isOther ? $t('input.otherPlaceholder') : $t('input.placeholder')}
                aria-label={question.question}
                aria-invalid={missingAnswer ? true : undefined}
                oninput={(event) => setAnswer(question.id, (event.currentTarget as HTMLInputElement).value)} />
            {/if}
          </fieldset>
        {/key}
      {:else}
        <p role="status">{$t('input.empty')}</p>
      {/if}
    </div>
    <div class="user-input-actions">
      <Button type="button" size="sm" variant="ghost" onclick={() => onCancel(request)} disabled={busy}>{$t('input.cancel')}</Button>
      <div class="user-input-step-actions">
        {#if multiple}
          <Button type="button" size="sm" variant="outline" onclick={() => selectQuestion(questionIndex - 1)} disabled={questionIndex === 0}>{$t('input.previous')}</Button>
        {/if}
        {#if questionIndex < request.questions.length - 1}
          <Button type="button" size="sm" onclick={() => selectQuestion(questionIndex + 1)}>{$t('input.next')}</Button>
        {:else}
          <Button type="button" size="sm" onclick={submit} disabled={busy || !question}>{multiple ? $t('input.submitAll') : $t('input.submit')}</Button>
        {/if}
      </div>
    </div>
  </CardContent>
</Card>
