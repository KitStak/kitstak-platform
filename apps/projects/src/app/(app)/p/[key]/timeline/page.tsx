import type { Metadata } from 'next';
import { TimelineView } from '@/features/timeline';

export const metadata: Metadata = { title: 'Timeline' };

export default function Page() {
  return <TimelineView />;
}
