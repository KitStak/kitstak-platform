import type { Metadata } from 'next';
import { MyWorkPage } from '@/features/my-work';

export const metadata: Metadata = { title: 'My work' };

export default function Page() {
  return <MyWorkPage />;
}
