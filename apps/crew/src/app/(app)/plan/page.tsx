import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Labor plan' };

export default function Page() {
  return <PhasePage id="plan" path="/plan" />;
}
