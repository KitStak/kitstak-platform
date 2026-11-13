'use client';
/**
 * Run history: every time an automation ran, what started it, which task it touched and what
 * it did. Used as the "Run history" tab and inside a rule's history drawer.
 */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, History, XCircle } from 'lucide-react';
import { Badge, Button, EmptyState, SkeletonRows, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { AutomationRunRowDTO } from '@/lib/types';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { LocalTime } from '@/features/task/local-time';

export type RunFilter = 'all' | 'success' | 'failed';

const EVENT_WORDS: Readonly<Record<string, string>> = {
  task_created: 'Task created',
  status_changed: 'Status changed',
  assignee_changed: 'Assignee changed',
  priority_changed: 'Priority changed',
  due_date_changed: 'Due date changed',
  label_added: 'Label added',
  comment_added: 'New comment',
  section_changed: 'Section changed',
  subtasks_completed: 'Subtasks done',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  crm_stage_changed: 'CRM deal moved',
  wms_order_shipped: 'WMS order shipped',
};

export function useRunHistory(
  automationId: string | null,
  filter: RunFilter,
  initialData?: AutomationRunRowDTO[],
) {
  return useQuery({
    queryKey: qk.automationRunHistory(automationId ?? 'all', filter),
    queryFn: () =>
      apiGet<AutomationRunRowDTO[]>(
        apiPath('automations/runs', {
          automationId: automationId ?? undefined,
          status: filter === 'all' ? undefined : filter,
          limit: 150,
        }),
      ),
    initialData,
    refetchInterval: 30_000,
  });
}

function ResultBadge({ status }: { readonly status: AutomationRunRowDTO['status'] }) {
  if (status === 'success')
    return (
      <Badge tone="success" icon={<CheckCircle2 aria-hidden />}>
        Worked
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge tone="danger" icon={<XCircle aria-hidden />}>
        Stopped
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={<CircleSlash aria-hidden />}>
      Skipped
    </Badge>
  );
}

export function RunHistoryList({
  runs,
  loading,
  showRuleName = true,
  onOpenRule,
  emptyHint,
}: {
  readonly runs: readonly AutomationRunRowDTO[];
  readonly loading?: boolean;
  readonly showRuleName?: boolean;
  readonly onOpenRule?: (automationId: string) => void;
  readonly emptyHint?: string;
}) {
  const { openTask } = useTaskDrawer();
  if (loading && runs.length === 0) return <SkeletonRows rows={6} className="p-4" />;
  if (runs.length === 0) {
    return (
      <EmptyState
        size="sm"
        visual={<History aria-hidden className="size-10 text-icon" />}
        title="Nothing has run yet"
        description={
          emptyHint ?? 'When an automation does something, it shows up here with the task it touched.'
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-border-subtle" data-testid="run-history">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex shrink-0 items-center gap-2 sm:w-36 sm:flex-col sm:items-start sm:gap-1">
            <ResultBadge status={run.status} />
            <LocalTime iso={run.createdAt} className="text-xs text-fg-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              {showRuleName ? (
                onOpenRule ? (
                  <button
                    type="button"
                    onClick={() => onOpenRule(run.automationId)}
                    className="rounded-xs font-semibold text-fg hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {run.automationName}
                  </button>
                ) : (
                  <span className="font-semibold text-fg">{run.automationName}</span>
                )
              ) : null}
              {run.event ? (
                <span className="text-xs text-fg-muted">{EVENT_WORDS[run.event] ?? run.event}</span>
              ) : null}
            </p>
            <p
              className={cn(
                'mt-0.5 text-sm',
                run.status === 'failed' ? 'text-danger-text' : 'text-fg-secondary',
              )}
            >
              {run.summary || 'No changes were needed.'}
            </p>
          </div>
          {run.taskKey ? (
            <Button
              size="sm"
              variant="ghost"
              className="max-w-full shrink-0 justify-start self-start sm:max-w-[260px]"
              data-task-key={run.taskKey}
              onClick={() => openTask(run.taskKey as string)}
            >
              <span className="font-key text-xs text-fg-muted">{run.taskKey}</span>
              <span className="truncate">{run.taskTitle}</span>
            </Button>
          ) : run.taskId ? (
            <span className="shrink-0 self-start text-xs text-fg-muted">Task was deleted</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
