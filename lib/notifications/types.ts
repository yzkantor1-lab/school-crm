// Shared shape for every notification type. Add a new type by writing its
// own generator (see cardExpirations.ts) and calling it from
// app/api/notifications/route.ts — the page groups and styles by `type` and
// `severity` alone, so nothing else needs to change.

export type NotificationSeverity = 'low' | 'medium' | 'high' | 'critical'

export type Notification = {
  id: string
  type: string
  severity: NotificationSeverity
  title: string
  description: string
  link?: string
  date?: string   // ISO date this notification is anchored to, for sorting within a type
}
