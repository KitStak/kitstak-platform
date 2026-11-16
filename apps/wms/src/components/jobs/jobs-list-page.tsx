'use client';

/**
 * Job Management `/jobs` (Logiwa 02 §1): 32 columns, 31 typed filters, default chip
 * "Job status in Pending, Started", and the bulk menus. Job code opens `/jobs/[id]`
 * (Logiwa has no job page).
 */
import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Eye, ListChecks, Settings2, Sparkles, Workflow } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { usePermissionSet } from './use-permissions';
import { LinkCell } from '@/components/grid/cells';
import { EmptyState } from '@/components/ui/empty-state';
import { JOB_COLUMNS, exportColumns } from '@/lib/grid-defs/jobs/columns';
import { JOB_DEFAULT_FILTER, JOBS_GRID } from '@/lib/grid-defs/jobs/jobs';
import { DateCell } from '@/components/grid/cells';
import { buildColumns, Dash, OverduePill, textCell } from './grid-columns';
import { JobActions, type JobFacts } from './job-actions';
import { jobTasksHref, type GridRow } from './jobs-client';
import { ListShell } from './list-shell';

export type JobRow = GridRow &
  JobFacts & {
    readonly waveId: string | null;
    readonly waveNumber: string | null;
    readonly overdue?: unknown;
  };

function LabelPill({ value }: { readonly value: unknown }) {
  const v = String(value ?? '');
  if (!v) return <Dash />;
  const tone =
    v === 'Labeled' || v === 'Printed'
      ? 'bg-[var(--label-green-subtle)] text-success'
      : v.startsWith('Partially')
        ? 'bg-[#FFF3D6] text-[#9A6700]'
        : 'bg-[var(--border-default)] text-[var(--text-muted)]';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold leading-4 ${tone}`}>
      {v}
    </span>
  );
}

function TaskCountLink({ row, value }: { readonly row: JobRow; readonly value: unknown }) {
  const n = Number(value ?? 0);
  return (
    <span className="block text-right tabular-nums">
      {n > 0 ? (
        <LinkCell href={jobTasksHref(String(row.code), row.operationType)}>
          {n.toLocaleString('en-US')}
        </LinkCell>
      ) : (
        <span className="text-faint">0</span>
      )}
    </span>
  );
}

const COLUMNS = buildColumns<JobRow>(JOB_COLUMNS, {
  primary: 'code',
  cells: {
    code: ({ row }) => (
      <LinkCell href={`/jobs/${encodeURIComponent(row.original.id)}`}>{String(row.original.code)}</LinkCell>
    ),
    flags: ({ row }) => {
      const short = Number(row.original.hasPickShort) > 0;
      const overdue = Number(row.original.overdue) > 0;
      if (!short && !overdue) return <Dash />;
      return (
        <span className="flex flex-wrap items-center gap-1">
          {short ? (
            <span
              className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-[var(--label-brown-subtle)] px-1.5 py-px text-2xs font-semibold leading-4 text-[var(--label-brown-text)] dark:bg-[#3A2116] dark:text-[#F5B38F]"
              title="Open pick short"
            >
              Short
            </span>
          ) : null}
          {overdue ? <OverduePill /> : null}
        </span>
      );
    },
    plannedEndAt: ({ row, getValue }) => {
      const v = getValue() as string | null;
      if (!v) return <Dash />;
      return Number(row.original.overdue) ? (
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--danger-text)] dark:text-[var(--label-red-light)]">
          <DateCell value={v} />
          <OverduePill />
        </span>
      ) : (
        <DateCell value={v} />
      );
    },
    waveNumber: ({ row }) =>
      row.original.waveNumber ? (
        <LinkCell href={`/jobs/wave-log?q=${encodeURIComponent(String(row.original.waveNumber))}&qm=eq`}>
          {String(row.original.waveNumber)}
        </LinkCell>
      ) : (
        <Dash />
      ),
    jobType: ({ row }) => {
      const v = row.original.jobType;
      if (!v) return <Dash />;
      return row.original.aiJob ? (
        <span className="flex min-w-0 items-center gap-1" title={String(row.original.aiJobDescription ?? v)}>
          <Sparkles
            className="h-3 w-3 shrink-0 text-[var(--label-purple-text)] dark:text-[var(--label-purple-light)]"
            aria-label="AI job"
          />
          <span className="truncate">{String(v)}</span>
        </span>
      ) : (
        textCell(v)
      );
    },
    labelStatus: ({ getValue }) => <LabelPill value={getValue()} />,
    pickListStatus: ({ getValue }) => <LabelPill value={getValue()} />,
    ruleName: ({ getValue }) => textCell(getValue()),
    taskCount: ({ row, getValue }) => <TaskCountLink row={row.original} value={getValue()} />,
    pendingTasks: ({ row, getValue }) => <TaskCountLink row={row.original} value={getValue()} />,
  },
});

const EXPORT = exportColumns(JOB_COLUMNS);

/** Job Types live under Settings; the Jobs hub links to them so they stay one click from Job Management. */
function JobTypesLink() {
  const { permissions } = usePermissionSet();
  if (!permissions.has('settings.job_types.view')) return <span aria-hidden className="block h-8" />;
  return (
    <Link href="/settings/job-types" className={buttonVariants({ variant: 'secondary' })}>
      <Settings2 className="h-3.5 w-3.5" aria-hidden />
      Job types
    </Link>
  );
}

export function JobsListPage() {
  return (
    <ListShell<JobRow>
      title="Job Management"
      tabs="jobs"
      actions={<JobTypesLink />}
      gridKey={JOBS_GRID.gridKey}
      path="/api/jobs"
      fields={JOBS_GRID.fields}
      columns={COLUMNS}
      exportColumns={EXPORT}
      searchPlaceholder={JOBS_GRID.searchPlaceholder}
      defaultFilters={[JOB_DEFAULT_FILTER]}
      quickFilters={[
        {
          key: 'overdue',
          label: 'Overdue',
          filter: { field: 'overdue', op: 'bool', value: true },
          countQuery: 'f.overdue=bool:true',
          tone: 'danger',
        },
      ]}
      noun="job"
      rowHref={(row) => `/jobs/${encodeURIComponent(row.id)}`}
      rowActions={(row) => [
        { key: 'details', label: 'Show details', icon: Eye, href: `/jobs/${encodeURIComponent(row.id)}` },
        {
          key: 'tasks',
          label: 'Show tasks',
          icon: ListChecks,
          href: jobTasksHref(String(row.code), row.operationType),
        },
      ]}
      trailing={({ selected, refresh }) => <JobActions jobs={selected} onChanged={refresh} />}
      emptyTitle="No open jobs"
      emptyDescription="Jobs are created when a wave rule runs or when orders are allocated manually."
      emptyAction={
        <EmptyState
          compact
          title=""
          cards={[
            {
              title: 'Run a wave rule',
              description: 'Select orders by your rules and turn them into jobs.',
              icon: Workflow,
              href: '/jobs/wave-rules',
            },
            {
              title: 'Check the wave log',
              description: 'See what the last waves met, allocated and created.',
              icon: CalendarClock,
              href: '/jobs/wave-log',
            },
          ]}
        />
      }
    />
  );
}
