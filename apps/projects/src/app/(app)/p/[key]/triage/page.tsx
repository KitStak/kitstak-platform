import type { Metadata } from 'next';
import { TriageView } from '@/features/projects/triage-view';

export const metadata: Metadata = { title: 'Triage' };

export default function Page() {
  return <TriageView />;
}
