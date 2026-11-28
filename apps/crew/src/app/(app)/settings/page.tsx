import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <PhasePage id="settings" path="/settings" />;
}
