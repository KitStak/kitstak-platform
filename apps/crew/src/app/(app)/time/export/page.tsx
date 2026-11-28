import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Payroll export' };

export default function Page() {
  return <PhasePage id="time-export" path="/time/export" />;
}
