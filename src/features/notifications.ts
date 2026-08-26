// ============================================
// IN-APP NOTIFICATION STORE
// ============================================

export interface AppNotification {
  id: string;
  type: string;
  message: string;
  time: string;
  read?: boolean;
}

const notifications: AppNotification[] = [];

export function pushNotification(type: string, message: string): void {
  notifications.unshift({
    id: 'nt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    type,
    message,
    time: new Date().toISOString(),
    read: false,
  });
  if (notifications.length > 50) notifications.pop();
}

export function getNotifications(): { items: AppNotification[]; unread: number } {
  return {
    items: notifications.slice(0, 20),
    unread: notifications.filter(n => !n.read).length,
  };
}

export function markAllRead(): void {
  notifications.forEach(n => n.read = true);
}
