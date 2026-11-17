import type { Metadata } from 'next';
import { SettingsClosePage } from '@/features/settings';

export const metadata: Metadata = { title: 'Month close' };

export default function Page() {
  return <SettingsClosePage />;
}
