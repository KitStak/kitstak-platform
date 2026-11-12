import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AlgorithmEditor } from '@/components/automation/algorithms/algorithm-editor';
import { AlgorithmEditorSkeleton } from '@/components/automation/algorithms/algorithm-editor-skeleton';
import { getAppDb } from '@/server/api/db';
import { getAuthContext } from '@/server/auth/context';
import { can } from '@/server/auth/permissions';
import { getAlgorithm } from '@/server/repositories/algorithms';

export const metadata: Metadata = { title: 'Edit Putaway Algorithm' };

/**
 * The algorithm is read on the server and handed to the editor, so the shell, Primary Information
 * and the canvas render in the first response instead of after a client fetch. A missing or
 * out-of-scope algorithm falls back to the client load, which shows the not-found state.
 */
async function Content({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  let initial = null;
  if (auth && can(auth, 'automation.algorithms.view')) {
    try {
      initial = await getAlgorithm(await getAppDb(), auth, id);
    } catch {
      initial = null;
    }
  }
  return <AlgorithmEditor slug="putaway" id={id} initial={initial} />;
}

export default function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<AlgorithmEditorSkeleton title="Edit Putaway Algorithm" />}>
      <Content params={params} />
    </Suspense>
  );
}
