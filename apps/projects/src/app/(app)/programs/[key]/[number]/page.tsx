import type { Metadata } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';
import { TaskPage } from '@/features/task/task-page';
import { getTaskSummary, resolveTaskKey } from '@/server/domain';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string; number: string }>;

/** "GLOVE-212 · Small Brown · Nov 25" (docs/programs/SPEC.md 5.1). */
export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const { key, number } = await params;
  const programKey = decodeURIComponent(key).toUpperCase();
  const parsed = Number(number);
  const fallback = { title: { absolute: `${programKey}-${number} · KitStak Projects` } };
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  try {
    const { ctx } = await pageContext(`/programs/${programKey}/${parsed}`);
    const task = await getTaskSummary(ctx, await resolveTaskKey(ctx, programKey, parsed));
    return { title: { absolute: `${programKey}-${parsed} · ${task.title} · KitStak Projects` } };
  } catch (error) {
    unstable_rethrow(error);
    return { title: { absolute: 'Not found · KitStak Projects' } };
  }
}

/** The full build page: the task detail with the build sections, in a focused document (no program header). */
export default async function Page({ params }: { readonly params: Params }) {
  const { key, number } = await params;
  const parsed = Number(number);
  if (!Number.isInteger(parsed) || parsed < 1) notFound();
  return <TaskPage projectKey={decodeURIComponent(key).toUpperCase()} number={parsed} />;
}
