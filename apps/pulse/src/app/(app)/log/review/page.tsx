import type { Metadata } from 'next';
import { LogReviewPage } from '@/features/log';

export const metadata: Metadata = { title: 'Review the day' };

export default function Page() {
  return <LogReviewPage />;
}
