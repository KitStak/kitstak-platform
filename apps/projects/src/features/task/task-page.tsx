import { notFound } from 'next/navigation';
import { getTaskDetail, listComments, listTaskActivity, listTaskTime, recordVisit, resolveTaskKey } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';
import { TaskDetailView, type TaskFeedInitial } from './task-detail';

/** Resolves to undefined when a read fails or takes longer than `ms` (the client then loads it). */
function soft<T>(promise: Promise<T>, ms = 1500): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

/**
 * Full-page task (/p/OPS/42): same detail as the drawer, wide two-column layout in a card.
 * Comments, the first page of history and the time entries load on the server next to the task,
 * so the first HTML has a real Activity feed and time list instead of skeletons.
 */
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
  const [comments, activity, time] = await Promise.all([
    soft(listComments(ctx, detail.id)),
    soft(listTaskActivity(ctx, detail.id, {})),
    soft(listTaskTime(ctx, detail.id)),
    recordVisit(ctx, 'task', detail.id),
  ]);
  const feed: TaskFeedInitial = { taskId: detail.id, loadedAt: Date.now(), comments, activity, time };
  return (
    <div className="mx-auto w-full max-w-[1280px] px-0 py-0 sm:px-6 sm:py-6">
      <div className="flex min-h-[calc(100dvh-220px)] flex-col overflow-hidden border-border-subtle bg-raised sm:rounded-xl sm:border sm:shadow-sm">
        <TaskDetailView taskRef={detail.key} variant="page" initialData={detail} initialFeed={feed} />
      </div>
    </div>
  );
}
