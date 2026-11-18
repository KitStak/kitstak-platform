import type { Metadata } from 'next';
import { TargetPacePage } from '@/features/target-pace';

export const metadata: Metadata = { title: 'Target pace' };

export default function Page() {
  return <TargetPacePage />;
}
