import type { Metadata } from 'next';
import { WorkspacePage } from '@/features/shell/pages/workspace-page';

export const metadata: Metadata = { title: 'Workspace' };

interface PageProps {
  readonly params: Promise<{ orgSlug: string; workspaceId: string }>;
}

export default async function Page({ params }: PageProps) {
  const { workspaceId } = await params;
  return <WorkspacePage workspaceId={workspaceId} />;
}
