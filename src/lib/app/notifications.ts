import type { LocalizedText } from '../../../packages/i18n/index.js';
/** Host-owned transient feedback. Producers choose semantics, never the renderer. */
export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export type AppNotification = {
  type: NotificationType;
  message: LocalizedText;
};

export type SetNotice = {
  (message: null): void;
  (message: LocalizedText, type: NotificationType): void;
};

export function notificationDuration(type: NotificationType): number {
  return type === 'warning' || type === 'error' ? 6000 : 3600;
}
