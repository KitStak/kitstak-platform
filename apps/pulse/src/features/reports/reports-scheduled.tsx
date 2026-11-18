'use client';
/**
 * The Scheduled tab of Reports: every schedule (when it builds, what it covers, who is told),
 * with Build now, edit, on and off, and delete with undo. Under it, the builds of the last 90
 * days with their files: a CSV, and a page to print or paste.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CircleAlert, Download, FileText, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Teach } from '@/components/pulse/teach';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import { apiPath } from '@/lib/api-client';
import { formatRelative } from '@/lib/dates';
import { useServerAction } from '@/lib/hooks/use-action';
import { useReportRuns, useReportSchedules } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import { SCHEDULE_RANGE_LABELS, scheduleSentence, type ScheduleRange } from '@/lib/reports';
import { routes } from '@/lib/routes';
import type { ReportScheduleDTO } from '@/lib/types';
import { deleteReportScheduleAction, restoreReportScheduleAction, runReportScheduleAction, setReportScheduleEnabledAction } from '@/server/actions/reports';
import { LoadError, Section, TableSkeleton, runDelete } from '@/features/profit/profit-ui';
import { ScheduleDialog } from './schedule-dialog';

function when(iso: string | null): string {
  if (!iso) return 'Not yet';
  const at = new Date(iso);
  return at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ReportsScheduled({ highlightRun }: { readonly highlightRun?: string | null }) {
  const queryClient = useQueryClient();
  const schedules = useReportSchedules();
  const runs = useReportRuns();
  const people = usePeopleMap();
  const [editing, setEditing] = useState<ReportScheduleDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const keys = [qk.reportSchedules(), qk.reportRuns()] as const;
  const run = useServerAction(runReportScheduleAction, { invalidate: keys, errorTitle: "Couldn't build the report" });
  const enable = useServerAction(setReportScheduleEnabledAction, { invalidate: keys });

  const buildNow = async (schedule: ReportScheduleDTO) => {
    setBuilding(schedule.id);
    const built = await run.run({ scheduleId: schedule.id });
    setBuilding(null);
    if (!built) return;
    if (built.status === 'failed') toast.error(`${schedule.name} could not be built`, built.error ?? 'Try it again from the report page.');
    else toast.success(`${schedule.name} is built`, `${built.rowCount} ${built.rowCount === 1 ? 'row' : 'rows'}. The files are under Past builds.`);
  };

  const toggle = async (schedule: ReportScheduleDTO, enabled: boolean) => {
    // Flip the switch right away; the refetch puts it back if the server said no.
    queryClient.setQueryData<ReportScheduleDTO[]>(qk.reportSchedules(), (current) => (current ?? []).map((item) => (item.id === schedule.id ? { ...item, enabled } : item)));
    const saved = await enable.run({ scheduleId: schedule.id, enabled });
    if (!saved) void queryClient.invalidateQueries({ queryKey: qk.reportSchedules() });
  };

  const deleteSchedule = async (schedule: ReportScheduleDTO) => {
    queryClient.setQueryData<ReportScheduleDTO[]>(qk.reportSchedules(), (current) => (current ?? []).filter((item) => item.id !== schedule.id));
    const deleted = await runDelete(deleteReportScheduleAction, { scheduleId: schedule.id }, "Couldn't delete the schedule");
    void queryClient.invalidateQueries({ queryKey: qk.reportSchedules() });
    if (!deleted) return;
    toast.undo(`Deleted the schedule ${schedule.name}`, {
      onUndo: async () => {
        const result = await restoreReportScheduleAction({ scheduleId: schedule.id });
        if (!result.ok) throw new Error(result.error.message);
        await queryClient.invalidateQueries({ queryKey: qk.reportSchedules() });
      },
    });
  };

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const list = schedules.data ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="reports-scheduled">
      {schedules.isError && !schedules.data ? (
        <LoadError what="your schedules" message={schedules.error instanceof Error ? schedules.error.message : undefined} onRetry={() => void schedules.refetch()} />
      ) : !schedules.data ? (
        <div className="rounded-xl border border-border-subtle bg-panel">
          <TableSkeleton label="Loading your schedules" rows={3} />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-panel shadow-xs">
          <Teach
            testId="schedules-empty"
            icon={CalendarClock}
            title="No report is on a schedule yet"
            why="Have Pulse build a report for you every day, week or month. When it is ready, the people you pick get a note in Pulse with the CSV and a page to print. Pulse does not send email."
            points={['Job profit every Monday for last week', 'Ready to bill on the first of each month', 'The daily production log each morning for the day before']}
            actions={
              <Button leadingIcon={<Plus aria-hidden />} onClick={openNew} data-testid="schedule-new-first">
                Schedule a report
              </Button>
            }
          />
        </div>
      ) : (
        <Section
          title={`Schedules, ${list.length}`}
          bodyClassName="p-0"
          testId="schedules-section"
          action={
            <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={openNew} data-testid="schedule-new">
              Schedule a report
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]" data-testid="schedules-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Covers</TableHeaderCell>
                  <TableHeaderCell>Who is told</TableHeaderCell>
                  <TableHeaderCell>Next build</TableHeaderCell>
                  <TableHeaderCell>Last build</TableHeaderCell>
                  <TableHeaderCell>On</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {list.map((schedule) => {
                  const range = (schedule.config as { range?: string }).range as ScheduleRange | undefined;
                  const told = schedule.recipientUserIds.map((id) => people.get(id)?.name ?? null).filter(Boolean) as string[];
                  return (
                    <TableRow key={schedule.id} data-testid="schedule-row">
                      <TableCell className="max-w-[260px]">
                        <span className="block truncate font-medium text-fg">{schedule.name}</span>
                        <Link href={routes.report(schedule.report)} className="rounded-sm text-xs text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                          {schedule.reportName}
                        </Link>
                        {schedule.includeMoney ? <span className="ml-2 text-xs text-fg-muted">with money</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{scheduleSentence(schedule)}</TableCell>
                      <TableCell className="whitespace-nowrap">{range ? SCHEDULE_RANGE_LABELS[range] : 'Last week'}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={told.join(', ')}>
                        {told.length === 0 ? `${schedule.recipientUserIds.length} ${schedule.recipientUserIds.length === 1 ? 'person' : 'people'}` : told.length <= 2 ? told.join(' and ') : `${told[0]} and ${told.length - 1} more`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{schedule.enabled ? when(schedule.nextRunAt) : <span className="text-fg-muted">Turned off</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">{schedule.lastRunAt ? formatRelative(schedule.lastRunAt) : 'Not yet'}</TableCell>
                      <TableCell>
                        <Switch checked={schedule.enabled} disabled={!schedule.canEdit} onCheckedChange={(value) => void toggle(schedule, value)} aria-label={`${schedule.name} is ${schedule.enabled ? 'on' : 'off'}`} data-testid="schedule-switch" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="secondary" size="sm" leadingIcon={<Play aria-hidden />} loading={building === schedule.id} disabled={!schedule.canEdit || building !== null} onClick={() => void buildNow(schedule)} data-testid="schedule-build">
                            Build now
                          </Button>
                          {schedule.canEdit ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton label={`Actions for ${schedule.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="schedule-actions" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  icon={<Pencil aria-hidden />}
                                  onSelect={() => {
                                    setEditing(schedule);
                                    setOpen(true);
                                  }}
                                >
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => void deleteSchedule(schedule)}>
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      <Section title="Past builds" hint="Kept for 90 days." bodyClassName="p-0" testId="runs-section">
        {runs.isError ? (
          <div className="p-4">
            <LoadError what="the past builds" onRetry={() => void runs.refetch()} compact />
          </div>
        ) : !runs.data ? (
          <TableSkeleton label="Loading the past builds" rows={3} />
        ) : runs.data.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-secondary" data-testid="runs-empty">
            No builds yet. A build shows up here each time a schedule runs, or when you press Build now.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]" data-testid="runs-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>Built</TableHeaderCell>
                  <TableHeaderCell>Report</TableHeaderCell>
                  <TableHeaderCell>Covers</TableHeaderCell>
                  <TableHeaderCell numeric>Rows</TableHeaderCell>
                  <TableHeaderCell>Files</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {runs.data.map((item) => (
                  <TableRow key={item.id} data-testid="run-row" data-selected={item.id === highlightRun ? 'true' : undefined} className={cn(item.id === highlightRun && 'bg-selected')}>
                    <TableCell className="whitespace-nowrap">{when(item.createdAt)}</TableCell>
                    <TableCell className="max-w-[240px]">
                      <span className="block truncate font-medium text-fg">{item.scheduleName ?? item.reportName}</span>
                      <span className="block truncate text-xs text-fg-muted">{item.reportName}</span>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-fg-secondary" title={item.periodLabel ?? undefined}>
                      {item.periodLabel}
                    </TableCell>
                    <TableCell numeric>{item.status === 'failed' ? '' : item.rowCount}</TableCell>
                    <TableCell>
                      {item.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-danger-text">
                          <CircleAlert aria-hidden className="size-4" />
                          {item.error ?? 'This build failed.'}
                        </span>
                      ) : item.canOpen ? (
                        <span className="flex items-center gap-3">
                          <a href={apiPath(`reports/runs/${item.id}`, { format: 'csv' })} download className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="run-csv">
                            <Download aria-hidden className="size-3.5" />
                            CSV
                          </a>
                          <a href={apiPath(`reports/runs/${item.id}`, { format: 'html' })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="run-html">
                            <FileText aria-hidden className="size-3.5" />
                            Page to print
                          </a>
                        </span>
                      ) : (
                        <span className="text-sm text-fg-muted">Holds money. Ask an admin if you need it.</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
      <ScheduleDialog open={open} onOpenChange={setOpen} schedule={editing} />
    </div>
  );
}
