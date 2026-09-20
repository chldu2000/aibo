export const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CLIPBOARD_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_CLIPBOARD_IMAGES = 8;
export type ClipboardImage = { mediaType: string; data: string };
/** Read event-owned data synchronously: the clipboard is no longer available after await. */
export function clipboardImageFiles(data: Pick<DataTransfer, 'items' | 'files'> | null): File[] {
  if (!data) return [];
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => file !== null);
  return items.length ? items : Array.from(data.files ?? []).filter(file => file.type.startsWith('image/'));
}
export async function encodeClipboardImages(files: File[]): Promise<ClipboardImage[]> {
  if (!files.length || files.length > MAX_CLIPBOARD_IMAGES) throw new Error('一次最多粘贴 8 张图片。');
  if (files.some(file => file.size > MAX_CLIPBOARD_IMAGE_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > MAX_CLIPBOARD_TOTAL_BYTES) {
    throw new Error('单张图片不能超过 10 MiB，一次粘贴总大小不能超过 20 MiB。');
  }
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) throw new Error('支持粘贴 PNG、JPEG、WebP 和 GIF 图片。');
  return Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { mediaType: file.type, data: btoa(binary) };
  }));
}
