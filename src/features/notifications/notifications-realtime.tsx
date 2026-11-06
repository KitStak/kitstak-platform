'use client';
import { useNotificationsRealtime } from './api';

/** Renders nothing: keeps the org-level notifications stream open so the bell badge is live. */
export function NotificationsRealtime() {
  useNotificationsRealtime();
  return null;
}
