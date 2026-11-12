import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import { BoardPage, BoardPageSkeleton } from '@/features/board-toolbar';

export const metadata: Metadata = { title: 'Board' };

interface BoardPageProps {
  readonly params: Promise<{ orgSlug: string; boardId: string }>;
}

const boardIdSchema = z.string().uuid();

export default async function BoardRoute({ params }: BoardPageProps) {
  const { boardId } = await params;
  if (!boardIdSchema.safeParse(boardId).success) notFound();
  return (
    <Suspense fallback={<BoardPageSkeleton />}>
      <BoardPage boardId={boardId} />
    </Suspense>
  );
}
