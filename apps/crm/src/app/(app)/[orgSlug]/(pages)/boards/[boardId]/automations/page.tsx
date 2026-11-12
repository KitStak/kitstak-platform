import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import { AutomationsCenter } from '@/features/automations/automations-center';

export const metadata: Metadata = { title: 'Automations' };

interface BoardAutomationsPageProps {
  readonly params: Promise<{ orgSlug: string; boardId: string }>;
}

const boardIdSchema = z.uuid();

export default async function BoardAutomationsPage({ params }: BoardAutomationsPageProps) {
  const { boardId } = await params;
  if (!boardIdSchema.safeParse(boardId).success) notFound();
  return (
    <Suspense>
      <AutomationsCenter boardId={boardId} />
    </Suspense>
  );
}
