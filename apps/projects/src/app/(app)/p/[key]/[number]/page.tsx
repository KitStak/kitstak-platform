import type { Metadata } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';
import { TaskPage } from '@/features/task/task-page';
import { getTaskSummary, resolveTaskKey } from '@/server/domain';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string; number: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const { key, number } = await params;
  const projectKey = decodeURIComponent(key).toUpperCase();
  const parsed = Number(number);
  const fallback = { title: `${projectKey}-${number}` };
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  try {
    const { ctx } = await pageContext(`/p/${projectKey}/${parsed}`);
    const task = await getTaskSummary(ctx, await resolveTaskKey(ctx, projectKey, parsed));
    return { title: `${projectKey}-${parsed} ${task.title}` };
  } catch (error) {
    unstable_rethrow(error);
    // The page itself shows the friendly "We couldn't find that task" state.
    return fallback;
  }
}

export default async function Page({ params }: { readonly params: Params }) {
  const { key, number } = await params;
  const parsed = Number(number);
  if (!Number.isInteger(parsed) || parsed < 1) notFound();
  return <TaskPage projectKey={decodeURIComponent(key).toUpperCase()} number={parsed} />;
}
