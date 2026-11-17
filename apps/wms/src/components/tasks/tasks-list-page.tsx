'use client';

/**
 * Task Details `/tasks/{order-operations|count|replenishment}` (Logiwa 02 §7): order
 * operations (67 columns, Task Operations / User Actions), count (48, read-only, rows open
 * the count plan) and replenishment (50, Cancel Task). Default chip: Job status in Pending, Started.
 */
import * as React from 'react';
import { Info, Sparkles, Workflow } from 'lucide-react';
import { LinkCell } from '@/components/grid/cells';
import { EmptyState } from '@/components/ui/empty-state';
import {
  COUNT_TASK_COLUMNS,
  ORDER_TASK_COLUMNS,
  REPLEN_TASK_COLUMNS,
  exportColumns,
  type JobsColumnDef,
} from '@/lib/grid-defs/jobs/columns';
import { TASK_DEFAULT_FILTER, TASK_GRIDS, type TaskKind } from '@/lib/grid-defs/jobs/tasks';
import { buildColumns, Dash, ShortPill, type CellRenderer } from '@/components/jobs/grid-columns';
import type { GridRow } from '@/components/jobs/jobs-client';
import { ListShell } from '@/components/jobs/list-shell';
import { TaskActions, type TaskFacts } from './task-actions';

/**
 * Count rows are location/SKU lines (row id "task:product"); actions work on the task, so the
 * selection is folded back to one entry per task id.
 */
function byTask<T extends { readonly id: string; readonly taskId?: unknown }>(rows: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const id = typeof r.taskId === 'string' && r.taskId ? r.taskId : r.id;
    if (!seen.has(id)) seen.set(id, { ...r, id });
  }
  return [...seen.values()];
}

export type TaskRow = GridRow &
  TaskFacts & {
    readonly orderId: string | null;
    readonly countPlanId: string | null;
    readonly productImage?: string | null;
  };

const link = (href: (r: TaskRow) => string | null, key: string): CellRenderer<TaskRow> =>
  function LinkValueCell({ row }) {
    const value = row.original[key];
    const h = href(row.original);
    return value ? (
      h ? (
        <LinkCell href={h}>{String(value)}</LinkCell>
      ) : (
        <span>{String(value)}</span>
      )
    ) : (
      <Dash />
    );
  };

const CELLS: Readonly<Record<string, CellRenderer<TaskRow>>> = {
  // Task ID is an identifier: no thousands separator ("1397", not "1,397").
  taskNo: ({ getValue }) => (
    <span className="font-medium tabular-nums text-foreground">
      {getValue() == null ? 'None' : String(getValue())}
    </span>
  ),
  jobCode: link((r) => (r.jobId ? `/jobs/${encodeURIComponent(r.jobId)}` : null), 'jobCode'),
  // Critic R3: Wave ID opens the wave log filtered to that wave, like Job code and Order code open their records.
  waveNumber: link(
    (r) =>
      r.waveNumber && !String(r.waveNumber).startsWith('Manual')
        ? `/jobs/wave-log?q=${encodeURIComponent(String(r.waveNumber))}&qm=eq`
        : null,
    'waveNumber',
  ),
  jobType: ({ row }) => {
    const v = row.original.jobType;
    if (!v) return <Dash />;
    const ai = String(v).startsWith('AI-');
    return (
      <span
        className="flex min-w-0 items-center gap-1"
        title={ai && row.original.aiJobDescription ? String(row.original.aiJobDescription) : String(v)}
      >
        {ai ? (
          <Sparkles
            className="h-3 w-3 shrink-0 text-[var(--label-purple-text)] dark:text-[var(--label-purple-light)]"
            aria-label="AI job"
          />
        ) : null}
        <span className="truncate">{String(v)}</span>
      </span>
    );
  },
  orderCode: link(
    (r) => (r.orderCode ? `/orders/${encodeURIComponent(String(r.orderCode))}` : null),
    'orderCode',
  ),
  countPlanCode: link(
    (r) => (r.countPlanId ? `/counts/${encodeURIComponent(r.countPlanId)}` : null),
    'countPlanCode',
  ),
  sku: link((r) => (r.sku ? `/products?q=${encodeURIComponent(String(r.sku))}&qm=eq` : null), 'sku'),
  sourceLocation: link(
    (r) => (r.sourceLocation ? `/locations?q=${encodeURIComponent(String(r.sourceLocation))}&qm=eq` : null),
    'sourceLocation',
  ),
  targetLocation: link(
    (r) => (r.targetLocation ? `/locations?q=${encodeURIComponent(String(r.targetLocation))}&qm=eq` : null),
    'targetLocation',
  ),
  pickShortStatus: ({ getValue }) => <ShortPill value={getValue()} />,
  packShortStatus: ({ getValue }) => <ShortPill value={getValue()} />,
  productImage: ({ row }) =>
    row.original.productImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={String(row.original.productImage)}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 rounded border border-border object-cover"
      />
    ) : (
      <span className="flex h-7 w-7 items-center justify-center rounded border border-dashed border-border text-2xs text-faint">
        No img
      </span>
    ),
};

const COPY: Readonly<
  Record<TaskKind, { readonly cols: readonly JobsColumnDef[]; readonly noun: string; readonly empty: string }>
> = {
  order: { cols: ORDER_TASK_COLUMNS, noun: 'task', empty: 'No open picking, packing or sorting tasks' },
  count: { cols: COUNT_TASK_COLUMNS, noun: 'count task', empty: 'No open count tasks' },
  replenishment: {
    cols: REPLEN_TASK_COLUMNS,
    noun: 'replenishment task',
    empty: 'No open replenishment tasks',
  },
};

const COLUMNS: Readonly<Record<TaskKind, ReturnType<typeof buildColumns<TaskRow>>>> = {
  order: buildColumns<TaskRow>(ORDER_TASK_COLUMNS, { primary: 'taskNo', cells: CELLS, statusDomain: 'task' }),
  count: buildColumns<TaskRow>(COUNT_TASK_COLUMNS, { primary: 'taskNo', cells: CELLS, statusDomain: 'task' }),
  replenishment: buildColumns<TaskRow>(REPLEN_TASK_COLUMNS, {
    primary: 'taskNo',
    cells: CELLS,
    statusDomain: 'task',
  }),
};

function Banner() {
  return (
    <div className="mx-6 mb-2 flex items-start gap-2 rounded-md border border-info/25 bg-info-soft px-3 py-2 text-xs leading-5 text-info">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Task Details shows every task of your orders and jobs in real time: who has it, where it picks from
        and where it goes. Select tasks to execute, re-route or reassign them.
      </span>
    </div>
  );
}

export function TasksListPage({ kind }: { readonly kind: TaskKind }) {
  const spec = TASK_GRIDS[kind];
  const copy = COPY[kind];
  const extraQuery = React.useMemo(() => ({ kind }), [kind]);
  return (
    <ListShell<TaskRow>
      title="Task details"
      tabs="tasks"
      banner={<Banner />}
      gridKey={spec.gridKey}
      path="/api/tasks"
      extraQuery={extraQuery}
      fields={spec.fields}
      columns={COLUMNS[kind]}
      exportColumns={exportColumns(copy.cols)}
      searchPlaceholder={spec.searchPlaceholder}
      defaultFilters={[TASK_DEFAULT_FILTER]}
      noun={copy.noun}
      selectable
      rowHref={
        kind === 'count'
          ? (row) => (row.countPlanId ? `/counts/${encodeURIComponent(row.countPlanId)}` : null)
          : undefined
      }
      trailing={({ selected, refresh }) => (
        <TaskActions tasks={byTask(selected)} onChanged={refresh} mode={kind} />
      )}
      emptyTitle={copy.empty}
      emptyDescription="Tasks appear here when a wave or a manual allocation creates jobs."
      emptyAction={
        <EmptyState
          compact
          title=""
          cards={[
            {
              title: 'Run a wave rule',
              description: 'Create jobs and their tasks from open orders.',
              icon: Workflow,
              href: '/jobs/wave-rules',
            },
          ]}
        />
      }
    />
  );
}
