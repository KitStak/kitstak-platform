import type { Metadata } from 'next';
import { NotificationsPage } from '@/components/layout/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };

export default function Notifications() {
  return <NotificationsPage />;
}
