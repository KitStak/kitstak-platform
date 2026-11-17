import type { Metadata } from 'next';
import { SettingsAuditPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return <SettingsAuditPage />;
}
