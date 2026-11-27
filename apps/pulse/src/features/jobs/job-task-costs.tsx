'use client';
/**
 * Cost by task (0014): for a job linked to a Projects project, the hours, labor cost and task
 * units of each task the work was tagged with, untagged lines last. One priced program stays one
 * job, and this panel still shows what each step (prebuild, labels, kit pack) cost.
 */
import { TriangleAlert } from 'lucide-react';
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { formatHours, formatMoney, formatNumber } from '@/lib/format';
import { useJobTaskCosts } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { JobDetailDTO } from '@/lib/types';
import { LoadError } from './job-ui';

export function JobTaskCosts({ job, seesMoney }: { readonly job: Pick<JobDetailDTO, 'number' | 'id'>; readonly seesMoney: boolean }) {
  const costs = useJobTaskCosts(job.number);
  if (costs.isPending) return <Skeleton className="h-32 w-full" />;
  if (costs.isError) return <LoadError what="the cost by task" onRetry={() => void costs.refetch()} />;
  const data = costs.data;
  if (!data.hasProject) return null;
  const tagged = data.rows.filter((row) => row.taskId !== null);
  const money = seesMoney && !data.moneyHidden;
  return (
    <Panel title="Cost by task" bodyClassName="flex flex-col gap-3 p-4 min-w-0" className="min-w-0">
      {data.untaggedEntries > 0 ? (
        <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-text" data-testid="task-untagged">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {formatNumber(data.untaggedEntries)} {data.untaggedEntries === 1 ? 'line has' : 'lines have'} no task ({formatHours(data.untaggedHours)} hours).
            Pick the task on Log work so each step shows its real cost.
          </span>
        </p>
      ) : null}
      {tagged.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm text-fg-secondary">
          <p>
            This job is linked to a project, so each line of work can say which task it was for, like prebuild or kit pack.
            Then this panel shows what each step cost, and the job keeps one price and one profit.
          </p>
          <ButtonLink href={routes.log({ job: job.number })} variant="secondary" size="sm">
            Tag today&apos;s work
          </ButtonLink>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <Table data-testid="task-costs">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Task</TableHeaderCell>
                <TableHeaderCell className="text-right">Labor hours</TableHeaderCell>
                {money ? <TableHeaderCell className="text-right">Labor cost</TableHeaderCell> : null}
                {money ? <TableHeaderCell className="text-right">Share</TableHeaderCell> : null}
                <TableHeaderCell className="text-right">Task units</TableHeaderCell>
                <TableHeaderCell className="text-right">Per labor hour</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.taskId ?? 'untagged'}>
                  <TableCell className={row.taskId === null || row.gone ? 'text-fg-muted' : undefined}>
                    {row.ref ? <span className="tabular-nums text-fg-secondary">{row.ref} </span> : null}
                    {row.title}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(row.hours)}</TableCell>
                  {money ? <TableCell className="text-right tabular-nums">{row.laborCostCents === null ? '' : formatMoney(row.laborCostCents)}</TableCell> : null}
                  {money ? <TableCell className="text-right tabular-nums">{row.sharePct === null ? '' : `${formatNumber(row.sharePct)}%`}</TableCell> : null}
                  <TableCell className="text-right tabular-nums">{row.taskUnits === null ? '' : formatNumber(row.taskUnits, { maxDigits: 0 })}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.unitsPerHour === null ? '' : formatNumber(row.unitsPerHour)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
