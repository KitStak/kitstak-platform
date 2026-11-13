import type { Metadata } from 'next';
import { AutomationsPage } from '@/features/automations';

export const metadata: Metadata = { title: 'Automations' };

export default function Page() {
  return <AutomationsPage />;
}
