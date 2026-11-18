'use client';
/**
 * The Deleted tab of Jobs: each deleted job with its number, name, client, who deleted it and
 * when, and a Restore button. Restore puts the job and its entries back in every list and report.
 */
import { useState } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toast,
} from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { PersonAvatar } from '@/components/pulse/person';
import { Teach } from '@/components/pulse/teach';
import { useDeletedJobs } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { DeletedJobDTO } from '@/lib/types';
import { restoreJobAction } from '@/server/actions/jobs';
import { LoadError } from './job-ui';
import { callAction, useJobActions } from './use-job-actions';

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Nov 18, 2026, 3:42 PM" in the reader's own time zone (so the server and browser text may differ). */
function DeletedWhen({ iso }: { readonly iso: string | null }) {
  if (!iso) return <span className="text-fg-muted">Not known</span>;
  return (
    <time dateTime={iso} suppressHydrationWarning className="whitespace-nowrap tabular-nums">
      {WHEN.format(new Date(iso))}
    </time>
  );
}

function DeletedBy({ job }: { readonly job: DeletedJobDTO }) {
  if (!job.deletedById) return <span className="text-sm text-fg-muted">Not known</span>;
  return <PersonAvatar userId={job.deletedById} showName />;
}

export function DeletedJobsView({ initialJobs }: { readonly initialJobs: readonly DeletedJobDTO[] | undefined }) {
  const query = useDeletedJobs({ initialData: initialJobs ? [...initialJobs] : undefined, refetchOnMount: 'always' });
  const actions = useJobActions();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());

  const restore = async (job: DeletedJobDTO) => {
    setRestoring(job.id);
    const back = await callAction(restoreJobAction({ jobId: job.id }), "Couldn't restore the job");
    if (back) {
      setRestored((current) => new Set(current).add(job.id));
      await actions.refresh();
      toast.success(`${job.number} is back`, 'It is in every list and report again, with all of its entries.');
    }
    setRestoring(null);
  };

  if (query.isError && !query.data) {
    return (
      <LoadError
        what="the deleted jobs"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy="true" data-testid="deleted-jobs-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <span className="sr-only">Loading the deleted jobs</span>
      </div>
    );
  }

  const jobs = query.data.filter((job) => !restored.has(job.id));
  if (jobs.length === 0) {
    return (
      <Panel>
        <Teach
          testId="deleted-jobs-empty"
          icon={Trash2}
          title="No deleted jobs"
          why="When someone deletes a job, the job and its numbers leave every list and report. The job waits here, with all of its entries, so you can bring it back."
          points={[
            'Each deleted job, with who deleted it and when',
            'Restore puts the job back in every list, total and report',
            'Entries logged on the job come back with it',
          ]}
          actions={<ButtonLink href={routes.jobs()}>See open jobs</ButtonLink>}
          footnote="To take a finished job off the lists and keep its numbers in reports, archive it instead."
        />
      </Panel>
    );
  }

  const restoreButton = (job: DeletedJobDTO) => (
    <Button
      variant="secondary"
      size="sm"
      leadingIcon={<ArchiveRestore aria-hidden />}
      loading={restoring === job.id}
      disabled={restoring !== null && restoring !== job.id}
      onClick={() => void restore(job)}
      aria-label={`Restore ${job.number}`}
      data-testid={`restore-${job.number}`}
    >
      Restore
    </Button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="deleted-jobs">
      <p className="text-sm text-fg-secondary">
        These jobs and their numbers are out of every list and report. Restore one to put it back, with all
        of its entries.
      </p>
      <div className="hidden overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs md:block">
        <Table aria-label="Deleted jobs" data-testid="deleted-jobs-table">
          <TableHead>
            <TableRow className="hover:bg-transparent">
              <TableHeaderCell>Job</TableHeaderCell>
              <TableHeaderCell>Client</TableHeaderCell>
              <TableHeaderCell>Deleted by</TableHeaderCell>
              <TableHeaderCell>Deleted on</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Restore</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id} data-testid={`deleted-row-${job.number}`}>
                <TableCell>
                  <span className="block font-medium text-fg">{job.name}</span>
                  <span className="block text-xs text-fg-muted">{job.number}</span>
                </TableCell>
                <TableCell>{job.clientName}</TableCell>
                <TableCell>
                  <DeletedBy job={job} />
                </TableCell>
                <TableCell>
                  <DeletedWhen iso={job.deletedAt} />
                </TableCell>
                <TableCell className="text-right">{restoreButton(job)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Deleted jobs" data-testid="deleted-jobs-cards">
        {jobs.map((job) => (
          <li key={job.id} className="rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{job.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {job.number}, {job.clientName}
                </span>
              </div>
              {restoreButton(job)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <span>Deleted by</span>
              <DeletedBy job={job} />
              <span>on</span>
              <DeletedWhen iso={job.deletedAt} />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted" aria-live="polite" data-testid="deleted-jobs-count">
        {jobs.length} deleted {jobs.length === 1 ? 'job' : 'jobs'}
      </p>
    </div>
  );
}
