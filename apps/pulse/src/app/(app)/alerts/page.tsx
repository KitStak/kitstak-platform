import type { Metadata } from 'next';
import { AlertsPage } from '@/features/alerts';

export const metadata: Metadata = { title: 'Alerts' };

export default function Page() {
  return <AlertsPage />;
}
