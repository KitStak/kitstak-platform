import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Connected apps' };

export default function Page() {
  return <PhasePage id="settings-apps" path="/settings/apps" />;
}
