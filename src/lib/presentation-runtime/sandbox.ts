import type { PresentationInput, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
import type { InstalledPresentationPackage } from './types';
import { verifyPresentationPackage } from './package.ts';

export type MountedSandbox = {
  readonly inherited?: boolean;
  activate(): void;
  update(input: PresentationInput): void;
  dispose(): void;
};

/** Candidate remains hidden and cannot dispatch until the host commits activation. */
export async function preparePresentationSandbox(
  target: HTMLElement,
  installed: InstalledPresentationPackage,
  initial: PresentationInput,
  onIntent: (intent: PresentationIntent) => void,
  onFailure: (error: Error) => void,
  signal?: AbortSignal,
  options: { localInputActions?: readonly string[] | ((input: PresentationInput) => readonly string[]); onRecover?: () => void; allowInheritance?: boolean; onInheritanceChange?: (inherited: boolean) => void; decorative?: boolean } = {},
): Promise<MountedSandbox> {
  const verified = await verifyPresentationPackage(JSON.stringify(installed.release.manifest), async path => {
    const value = installed.resources[path];
    if (typeof value !== 'string' || value.length > 12 * 1024 * 1024) throw Error('missing_presentation_resource');
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
  });
  if (!verified.manifest.entry || !verified.manifest.surfaces?.includes(initial.surface)) throw Error('unsupported_presentation_surface');
  if (signal?.aborted) throw Error('presentation_preparation_aborted');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const source = decoder.decode(verified.resources.get(verified.manifest.entry));
  const assets: Record<string, string> = {};
  for (const resource of verified.manifest.resources) {
    if (resource.mediaType.startsWith('image/') || resource.mediaType === 'font/woff2') {
      assets[resource.path] = `data:${resource.mediaType};base64,${installed.resources[resource.path]}`;
    }
  }
  const css = verified.manifest.resources.filter(resource => resource.mediaType === 'text/css')
    .map(resource => decoder.decode(verified.resources.get(resource.path))).join('\n')
    .replace(/aibo-resource:([a-zA-Z0-9_./-]+)/g, (_match, path: string) => {
      if (!assets[path]) throw Error('missing_presentation_asset');
      return assets[path];
    });
  const frame = target.ownerDocument.createElement('iframe');
  frame.title = installed.release.manifest.displayName;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
  frame.setAttribute('frameborder', '0');
  if (options.decorative) { frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true'); }
  frame.style.width = '100%'; frame.style.height = '100%';
  frame.hidden = true;
  const channel = new MessageChannel();
  let input = structuredClone(initial), active = false, ready = false, disposed = false;
  const inputActions = (value: PresentationInput) => typeof options.localInputActions === 'function' ? options.localInputActions(value) : options.localInputActions ?? [];
  let localInputActions = inputActions(initial);
  let acceptedEdits = 0;
  let inherited = false;
  let timeout: ReturnType<typeof setTimeout>;
  let resolveReady: (value: MountedSandbox) => void;
  let rejectReady: (error: Error) => void;
  const promise = new Promise<MountedSandbox>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function dispose() {
    if (disposed) return;
    disposed = true; active = false; clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    channel.port1.postMessage({ type: 'dispose' });
    channel.port1.close(); frame.remove();
  }
  function fail(message: string) {
    if (disposed) return;
    const error = Error(message);
    const wasReady = ready;
    dispose();
    if (wasReady) onFailure(error); else rejectReady(error);
  }
  function armTimeout() { clearTimeout(timeout); timeout = setTimeout(() => fail('presentation_sandbox_timeout'), 5000); }
  function abort() { fail('presentation_preparation_aborted'); }
  const instance: MountedSandbox = {
    get inherited() { return inherited; },
    activate() { if (disposed) throw Error('presentation_disposed'); active = true; frame.hidden = inherited; },
    update(next) {
      if (disposed) return;
      if (next.context.revision <= input.context.revision) throw Error('presentation_revision_must_increase');
      input = structuredClone(next); localInputActions = inputActions(input); armTimeout(); channel.port1.postMessage({ type: 'update', input, acceptedEdits, localInputActions });
    },
    dispose,
  };
  channel.port1.onmessage = ({ data }) => {
    if (disposed || !data) return;
    if (data.type === 'connected') { channel.port1.postMessage({ type: 'start', source, css, assets, input, localInputActions, allowInheritance: options.allowInheritance === true && initial.surface === 'controls' }); }
    else if ((data.type === 'rendered' || (data.type === 'inherit' && options.allowInheritance && initial.surface === 'controls')) && data.revision === input.context.revision) {
      clearTimeout(timeout);
      inherited = data.type === 'inherit';
      frame.hidden = !active || inherited;
      options.onInheritanceChange?.(inherited);
      frame.dataset.presentationRevision = String(data.revision);
      if (!ready) { ready = true; resolveReady(instance); }
    } else if (data.type === 'failure') fail(typeof data.message === 'string' ? data.message.slice(0, 512) : 'presentation_failed');
    else if (data.type === 'recovery' && active) {
      if (options.onRecover) options.onRecover(); else fail('presentation_recovery_requested');
    }
    else if (data.type === 'intent' && active) {
      const intent = data.intent;
      if (!intent || typeof intent.id !== 'string' || intent.id.length > 256
        || (intent.context?.revision !== input.context.revision && !(intent.event === 'input' && localInputActions.includes(intent.id)))
        || intent.context?.workspaceId !== input.context.workspaceId || intent.context?.sessionId !== input.context.sessionId
        || (intent.value !== undefined && (typeof intent.value !== 'string' || intent.value.length > 1024 * 1024))
        || (intent.key !== undefined && (typeof intent.key !== 'string' || intent.key.length > 64))) return;
      if (intent.event === 'input' && localInputActions.includes(intent.id)) {
        if (!Number.isSafeInteger(intent.editSequence) || intent.editSequence <= acceptedEdits) return;
        acceptedEdits = intent.editSequence;
      }
      onIntent(intent);
    }
  };
  channel.port1.start();
  let loaded = false;
  frame.addEventListener('load', () => {
    if (loaded) { fail('presentation_unexpected_navigation'); return; }
    loaded = true;
    frame.contentWindow?.postMessage({ type: 'aibo-presentation-connect' }, '*', [channel.port2]);
  });
  frame.addEventListener('error', () => fail('presentation_document_failed'));
  frame.src = new URL('/aibo-presentation-sandbox.html', target.ownerDocument.baseURI).href;
  signal?.addEventListener('abort', abort, { once: true });
  armTimeout(); target.append(frame);
  return promise;
}
