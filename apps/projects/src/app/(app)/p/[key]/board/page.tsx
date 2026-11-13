import type { Metadata } from 'next';
import { BoardView } from '@/features/board';

export const metadata: Metadata = { title: 'Board' };

export default function Page() {
  return <BoardView />;
}
