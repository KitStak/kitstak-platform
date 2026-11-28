import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Time clocks' };

export default function Page() {
  return <PhasePage id="settings-kiosks" path="/settings/kiosks" />;
}
