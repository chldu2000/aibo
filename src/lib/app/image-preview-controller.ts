import type { LocalizedText } from '../../../packages/i18n/index.js';
import { toErrorText } from './error-utils.ts';
import { localizedMessage } from '../../../packages/i18n/index.js';

export function createImageSaveController(save: (sessionId: string, attachmentId: string) => Promise<string | null>, busy: (value: boolean) => void, notice: (message: LocalizedText, kind: 'success' | 'error') => void) {
  let saving = false;
  return async (sessionId: string, attachmentId: string) => {
    if (saving) return;
    saving = true; busy(true);
    try {
      const path = await save(sessionId, attachmentId);
      if (path !== null) notice(localizedMessage('attachments.savedTo', { path }), 'success');
    } catch (error) {
      notice(localizedMessage('attachments.saveFailed', { error: toErrorText(error) }), 'error');
    } finally { saving = false; busy(false); }
  };
}

export type ImagePreviewState = { sessionId: string; attachmentId: string; name: string; url: string | null; error: LocalizedText | null } | null;

/** The host owns the viewer; closing or navigating invalidates pending image reads. */
export function createImagePreviewController(read: (sessionId: string, attachmentId: string) => Promise<string>, publish: (state: ImagePreviewState) => void) {
  let generation = 0;
  return {
    close() { generation++; publish(null); },
    async open(sessionId: string, attachmentId: string, name: string) {
      const ticket = ++generation;
      const state = { sessionId, attachmentId, name, url: null, error: null };
      publish(state);
      try {
        const url = await read(sessionId, attachmentId);
        if (ticket === generation) publish({ ...state, url });
      } catch (error) {
        if (ticket === generation) publish({ ...state, error: toErrorText(error) });
      }
    },
  };
}
