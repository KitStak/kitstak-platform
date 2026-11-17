import type { Metadata } from 'next';
import { WallPage } from '@/features/wall';

export const metadata: Metadata = { title: 'Wall display' };

export default function Page() {
  return <WallPage />;
}
