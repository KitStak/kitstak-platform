import type { Metadata } from 'next';
import { PhasePage } from '@/features/phase/phase-page';

export const metadata: Metadata = { title: 'Home' };

export default function Page() {
  return <PhasePage id="home" path="/" />;
}
