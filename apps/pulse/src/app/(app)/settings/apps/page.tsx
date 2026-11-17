import type { Metadata } from 'next';
import { SettingsAppsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Connected apps' };

export default function Page() {
  return <SettingsAppsPage />;
}
