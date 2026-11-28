import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Target pace' };

export default function Page() {
  return <PhasePage id="plan-paces" path="/plan/paces" />;
}
