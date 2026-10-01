/** Host-owned transient feedback. Producers choose semantics, never the renderer. */
export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export type AppNotification = {
  type: NotificationType;
  message: string;
};

export type SetNotice = {
  (message: null): void;
  (message: string, type: NotificationType): void;
};

export function notificationDuration(type: NotificationType): number {
  return type === 'warning' || type === 'error' ? 6000 : 3600;
}
