<script lang="ts" generics="Name extends PresentationControl">
  import { untrack, type Snippet } from 'svelte';
  import type { ExternalPresentation } from '../external-presentation';
  import type { PresentationControlScope } from '../control-context';
  import { controlFrame, controlInput, decorativeLabel, isDecorativeControl, resolveControlIntent, type ControlEffect, type ControlProps, type PresentationControl } from '../../presentation-runtime/controls';
  import { preparePresentationSandbox, type MountedSandbox } from '../../presentation-runtime/sandbox';
  import { locale } from '$lib/i18n/runtime';
  import SelectMenu from './SelectMenu.svelte';
  let { control, props, presentation, scope, children }: {
    control: Name;
    props: ControlProps[Name];
    presentation: ExternalPresentation;
    scope: PresentationControlScope;
    children: Snippet;
  } = $props();
  type MenuEffect = Extract<ControlEffect<ControlProps[Name]>, { kind: 'menu' }>;
  let target: HTMLSpanElement;
  let fallback: HTMLSpanElement;
  let inherited = $state(true), failed = $state(false);
  let footprint = $state<{ width: number; height: number } | null>(null);
  /** Rendered height reported by the frame for content-sized controls, clamped so a package cannot take over the layout. */
  let contentHeight = $state<number | null>(null);
  const MAX_CONTENT_HEIGHT = 480;
  let menu = $state<{ effect: MenuEffect; anchor: DOMRect } | null>(null);
  let mounted: MountedSandbox | null = null;
  let revision = 0;
  const input = $derived(controlInput(control, props, scope.context(), presentation.theme, $locale));
  const label = $derived(decorativeLabel(control, props, $locale));
  const frame = $derived(controlFrame(control));
  // Options follow the current props; a menu whose control became unavailable disappears.
  const menuSpec = $derived(menu && !inherited && !failed ? menu.effect.menu(props, $locale) : null);
  function fail() { mounted?.dispose(); mounted = null; menu = null; inherited = true; failed = true; }
  /** The replacement occupies the default control's box, so the surrounding layout does not move. */
  function measure() {
    const boxes = [...fallback.children].map(child => child.getBoundingClientRect()).filter(box => box.width && box.height);
    if (!boxes.length) return;
    const left = Math.min(...boxes.map(box => box.left)), right = Math.max(...boxes.map(box => box.right));
    const top = Math.min(...boxes.map(box => box.top)), bottom = Math.max(...boxes.map(box => box.bottom));
    footprint = { width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
  }
  function closeMenu() {
    menu = null;
    target?.querySelector('iframe')?.focus();
  }
  /** The effect is captured when the menu opens; the choice is re-validated against current props. */
  function chooseMenu(effect: MenuEffect, value: string) {
    const run = effect.choose(props, value);
    if (run) void Promise.resolve().then(run).catch(fail);
  }
  $effect(() => {
    const registration = presentation;
    const kind = control;
    const abort = new AbortController();
    let candidate: MountedSandbox | null = null;
    failed = false; inherited = true;
    untrack(() => {
      const version = ++revision;
      const initial = $state.snapshot(input);
      void preparePresentationSandbox(target, registration.package, { ...initial, context: { ...initial.context, revision: version } }, intent => {
        if (scope.suspended()) return;
        const context = scope.context();
        if (intent.context.workspaceId !== context.workspaceId || intent.context.sessionId !== context.sessionId) return;
        // Resolve against the current props: a stale token or a disabled option does nothing.
        const effect = resolveControlIntent(kind, props, intent);
        if (effect?.kind === 'run') void Promise.resolve().then(effect.run).catch(fail);
        else if (effect?.kind === 'menu') menu = { effect, anchor: target.getBoundingClientRect() };
      }, fail, abort.signal, { allowInheritance: true, onInheritanceChange: value => {
        if (!value && (controlFrame(kind) === 'footprint' || controlFrame(kind) === 'content')) measure();
        if (value) menu = null;
        inherited = value;
      }, onRecover: registration.recover, decorative: isDecorativeControl(kind),
        onSize: controlFrame(kind) === 'content' ? height => { contentHeight = Math.min(height, MAX_CONTENT_HEIGHT); } : undefined }).then(instance => {
        if (abort.signal.aborted) { instance.dispose(); return; }
        candidate = instance; mounted = instance; instance.activate();
        if (revision > version) { const next = $state.snapshot(input); instance.update({ ...next, context: { ...next.context, revision } }); }
      }).catch(() => { if (!abort.signal.aborted) fail(); });
    });
    return () => { abort.abort(); candidate?.dispose(); if (mounted === candidate) mounted = null; menu = null; };
  });
  $effect(() => {
    const next = $state.snapshot(input);
    const version = ++revision;
    if (mounted && !failed) mounted.update({ ...next, context: { ...next.context, revision: version } });
  });
</script>
<span class="external-control-default" bind:this={fallback}>{#if inherited || failed}{@render children()}{/if}</span>
<span class="external-control" class:status-mark={frame === 'mark'} class:footprint={frame === 'footprint'}
  style:width={frame === 'footprint' ? `${footprint?.width ?? 160}px` : undefined}
  style:height={frame === 'footprint' ? `${footprint?.height ?? 32}px` : frame === 'content' ? `${contentHeight ?? footprint?.height ?? 48}px` : undefined}
  role={label !== null ? 'img' : undefined} aria-label={label ?? undefined} aria-hidden={isDecorativeControl(control) && label === null ? 'true' : undefined}
  hidden={inherited || failed} bind:this={target}></span>
{#if menu && menuSpec}
  {@const effect = menu.effect}
  <SelectMenu anchor={menu.anchor} options={menuSpec.options} value={menuSpec.value} label={menuSpec.label} onSelect={value => chooseMenu(effect, value)} onClose={closeMenu} />
{/if}
<style>
  .external-control-default { display: contents; }
  .external-control { display: block; width: 100%; height: 250px; }
  .external-control.status-mark { display: inline-block; width: 20px; height: 20px; pointer-events: none; }
  .external-control.footprint { display: inline-block; vertical-align: middle; }
  .external-control[hidden] { display: none; }
  /* A color-scheme mismatch with the frame document would make browsers paint an opaque canvas. */
  .external-control :global(iframe) { color-scheme: normal; background: transparent; }
</style>
