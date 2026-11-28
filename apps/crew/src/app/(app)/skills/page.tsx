import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Skills' };

export default function Page() {
  return <PhasePage id="skills" path="/skills" />;
}
