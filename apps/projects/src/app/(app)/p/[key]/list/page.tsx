import type { Metadata } from 'next';
import { ListView } from '@/features/list';

export const metadata: Metadata = { title: 'List' };

export default function Page() {
  return <ListView />;
}
