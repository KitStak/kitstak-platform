import { notFound } from 'next/navigation';
import { getTaskDetail, recordVisit, resolveTaskKey } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';
import { TaskDetailView } from './task-detail';

/** Full-page task (/p/OPS/42): same detail as the drawer, wide two-column layout in a card. */
export async function TaskPage({
  projectKey,
  number,
}: {
  readonly projectKey: string;
  readonly number: number;
}) {
  const { ctx } = await pageContext(`/p/${projectKey}/${number}`);
  const detail = await resolveTaskKey(ctx, projectKey, number)
    .then((taskId) => getTaskDetail(ctx, taskId))
    .catch((error: unknown) => {
      if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
      throw error;
    });
  await recordVisit(ctx, 'task', detail.id);
  return (
    <div className="mx-auto w-full max-w-[1280px] px-0 py-0 sm:px-6 sm:py-6">
      <div className="flex min-h-[calc(100dvh-220px)] flex-col overflow-hidden border-border-subtle bg-raised sm:rounded-xl sm:border sm:shadow-sm">
        <TaskDetailView taskRef={detail.key} variant="page" initialData={detail} />
      </div>
    </div>
  );
}
