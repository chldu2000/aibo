import type { ContextAttachment } from '../types';
/** Session-scoped cache; late reads cannot populate another session's previews. */
export function createAttachmentPreviews(read: (sessionId: string, id: string) => Promise<string>, changed: (values: Record<string, string | null>) => void) {
 let session: string | null = null, generation = 0;
 let values: Record<string, string | null> = {};
 const requested = new Set<string>();
 return {
  update(sessionId: string | null, attachments: ContextAttachment[]) {
   if (session !== sessionId) { session = sessionId; generation++; values = {}; requested.clear(); changed(values); }
   const current = generation;
   const images = attachments.filter(item => item.sessionId === sessionId && item.mediaType.startsWith('image/'));
   const ids = new Set(images.map(item => item.id));
   let removed = false;
   for (const id of requested) if (!ids.has(id)) { requested.delete(id); delete values[id]; removed = true; }
   if (removed) { values = {...values}; changed(values); }
   for (const item of images) {
    if (requested.has(item.id)) continue;
    requested.add(item.id);
    void read(item.sessionId, item.id).then(value => settle(value), () => settle(null));
    function settle(value: string | null) {
     if (generation !== current || !requested.has(item.id)) return;
     values = { ...values, [item.id]: value }; changed(values);
    }
   }
  },
 };
}
