'use client';
/**
 * The job page frame: header (name, client, stage menu, status with reasons, owner and due date
 * edited in place, linked records), the tab bar, and the tab that is open. The job is kept fresh
 * with React Query, starting from what the server rendered.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronDown,
  ClipboardPen,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  IsoDatePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from '@/components/ui';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { PersonAvatar } from '@/components/pulse/person';
import { RouteTabs } from '@/components/pulse/route-tabs';
import { useShell } from '@/features/shell/shell-context';
import { useJob, usePeople } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit/calendar';
import { JOB_TABS, JOB_TAB_LABELS, routes, type JobTab } from '@/lib/routes';
import type { JobDetailDTO, JobTypeDTO, LaborClassDTO, SettingsDTO, VasServiceDTO } from '@/lib/types';
import { updateJobAction } from '@/server/actions/jobs';
import { recordRecentJobAction } from '@/server/actions/views';
import { DeleteJobDialog } from './delete-job-dialog';
import { EditJobDialog } from './forms/job-dialogs';
import { JobActivity } from './job-activity';
import { useRefreshJob } from './job-data';
import { JobMaterials } from './job-materials';
import { JobMoneyIn } from './job-money-in';
import { JobOverview } from './job-overview';
import { JobPlan } from './job-plan';
import { JobStatusBadge, RiskPill } from './job-ui';
import { JobWork } from './job-work';
import { STATUS_MOVES, callAction, statusMoveLabel, useJobActions } from './use-job-actions';

/** Tabs a reader who may not see money does not get. */
const MONEY_TABS: readonly JobTab[] = ['plan', 'money-in'];

export interface JobFrameProps {
  readonly initialJob: JobDetailDTO;
  readonly tab: JobTab;
  readonly today: string;
  readonly settings: SettingsDTO;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly services: readonly VasServiceDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
}

export function JobFrame({
  initialJob,
  tab,
  today,
  settings,
  laborClasses,
  services,
  jobTypes,
}: JobFrameProps) {
  const shell = useShell();
  const router = useRouter();
  const refresh = useRefreshJob();
  const people = usePeople();
  const query = useJob(initialJob.number, { initialData: initialJob });
  const job = query.data ?? initialJob;
  const canManage = shell.can('job:manage');
  const [editing, setEditing] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [due, setDue] = useState(job.dueDate ?? '');
  const recorded = useRef(false);
  const actions = useJobActions({
    onHide: () => undefined,
    onCopied: (copy) => router.push(routes.job(copy.number)),
  });

  // Remember this job in "recent jobs" (command palette, home). Best effort.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void recordRecentJobAction({ jobId: initialJob.id }).catch(() => undefined);
  }, [initialJob.id]);

  const patch = async (
    change: { ownerId?: string | null; dueDate?: string | null },
    message: string,
    undo: { ownerId?: string | null; dueDate?: string | null },
  ) => {
    const saved = await callAction(updateJobAction({ jobId: job.id, patch: change }));
    if (!saved) return;
    await refresh();
    toast.undo(message, {
      id: `job-patch:${job.id}`,
      onUndo: async () => {
        const back = await callAction(updateJobAction({ jobId: job.id, patch: undo }), "Couldn't undo");
        if (back) await refresh();
      },
    });
  };

  const tabs = JOB_TABS.filter((id) => shell.seesMoney || !MONEY_TABS.includes(id));
  const tabProps = { job, today, settings, laborClasses, services };
  const ownerName = people.data?.find((person) => person.id === job.ownerId)?.name;

  return (
    <Page
      title={job.name}
      subtitle={`${job.number} · ${job.clientName} · ${job.jobTypeName}${job.siteName ? ` · ${job.siteName}` : ''}`}
      breadcrumbs={[{ label: 'Jobs', href: routes.jobs() }, { label: job.number }]}
      actions={
        <>
          {shell.can('production:log') && job.status !== 'completed' && job.status !== 'cancelled' ? (
            <ButtonLink
              href={routes.jobTab(job.number, 'work')}
              icon={<ClipboardPen aria-hidden />}
              testId="job-log-work"
            >
              Log work
            </ButtonLink>
          ) : null}
          {canManage ? (
            <Button
              variant="secondary"
              leadingIcon={<Pencil aria-hidden />}
              onClick={() => setEditing(true)}
              data-testid="job-edit"
            >
              Edit
            </Button>
          ) : null}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label="More actions for this job"
                  icon={<MoreHorizontal aria-hidden />}
                  variant="outline"
                  data-testid="job-more"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  icon={<Copy aria-hidden />}
                  onSelect={() => void actions.duplicate(job)}
                  data-testid="job-copy"
                >
                  Copy this job
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={job.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  disabled={job.status === 'active' && job.archivedAt === null}
                  description={
                    job.status === 'active' && job.archivedAt === null
                      ? 'Finish, hold or cancel the job first'
                      : undefined
                  }
                  onSelect={() => void actions.archive(job, job.archivedAt === null)}
                  data-testid="job-archive"
                >
                  {job.archivedAt ? 'Bring back from the archive' : 'Archive'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="danger"
                  icon={<Trash2 aria-hidden />}
                  onSelect={() => actions.askRemove(job)}
                  data-testid="job-delete"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
      tabs={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2" data-testid="job-meta">
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Stage: ${job.status.replace('_', ' ')}. Change it`}
                    data-testid="job-stage"
                    className="inline-flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <JobStatusBadge status={job.status} />
                    <ChevronDown aria-hidden className="size-3.5 text-fg-muted" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Move this job</DropdownMenuLabel>
                  {STATUS_MOVES[job.status].map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onSelect={() => void actions.setStatus(job, status)}
                      data-testid={`job-stage-${status}`}
                    >
                      {statusMoveLabel(job.status, status)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <JobStatusBadge status={job.status} />
            )}
            {job.archivedAt ? (
              <span className="rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-fg-secondary">
                Archived
              </span>
            ) : null}
            <RiskPill job={job} />

            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="job-owner"
                    aria-label={`Owner: ${ownerName ?? 'nobody'}. Change it`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2 text-sm text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {job.ownerId ? (
                      <PersonAvatar userId={job.ownerId} size="xs" decorative />
                    ) : (
                      <UserRound aria-hidden className="size-3.5 text-fg-muted" />
                    )}
                    <span className="max-w-[140px] truncate">{ownerName ?? 'No owner'}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuLabel>Who owns this job?</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() =>
                      job.ownerId
                        ? void patch({ ownerId: null }, 'Owner cleared', { ownerId: job.ownerId })
                        : undefined
                    }
                  >
                    No owner
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {(people.data ?? []).map((person) => (
                    <DropdownMenuItem
                      key={person.id}
                      onSelect={() =>
                        person.id === job.ownerId
                          ? undefined
                          : void patch({ ownerId: person.id }, `${person.name} now owns ${job.number}`, {
                              ownerId: job.ownerId,
                            })
                      }
                    >
                      {person.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : ownerName ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
                <PersonAvatar userId={job.ownerId} size="xs" decorative />
                {ownerName}
              </span>
            ) : null}

            {canManage ? (
              <Popover
                open={dueOpen}
                onOpenChange={(open) => {
                  setDueOpen(open);
                  if (open) setDue(job.dueDate ?? '');
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="job-due"
                    aria-label={`Due date: ${job.dueDate ? shortDate(job.dueDate) : 'not set'}. Change it`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2 text-sm text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <CalendarDays aria-hidden className="size-3.5 text-fg-muted" />
                    {job.dueDate ? `Due ${shortDate(job.dueDate)}` : 'No due date'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64">
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setDueOpen(false);
                      if ((due || null) !== job.dueDate)
                        void patch(
                          { dueDate: due || null },
                          due ? `Due date is now ${shortDate(due)}` : 'Due date cleared',
                          { dueDate: job.dueDate },
                        );
                    }}
                  >
                    <label htmlFor="job-due-input" className="text-xs font-medium text-fg-secondary">
                      Due date
                    </label>
                    <IsoDatePicker
                      id="job-due-input"
                      value={due || null}
                      onChange={(value) => setDue(value ?? '')}
                      clearable={false}
                      placeholder="No due date"
                      data-testid="job-due-input"
                    />
                    <div className="flex justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDue('')}>
                        Clear
                      </Button>
                      <Button type="submit" size="sm" data-testid="job-due-save">
                        Save
                      </Button>
                    </div>
                  </form>
                </PopoverContent>
              </Popover>
            ) : job.dueDate ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
                <CalendarDays aria-hidden className="size-3.5" />
                Due {shortDate(job.dueDate)}
              </span>
            ) : null}

            <Link
              href={routes.client(job.clientId)}
              className="inline-flex h-7 items-center rounded-md px-1.5 text-sm text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {job.clientName}
            </Link>
            {job.links
              .filter((link) => link.url || link.title)
              .slice(0, 3)
              .map((link) =>
                link.url ? (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="job-link-chip"
                    className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-md border border-border-subtle bg-panel px-2 text-xs text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="truncate">{link.title ?? 'Linked record'}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  // No address: the app is not on the plan, or no path was saved. Plain words, never a dead link.
                  <span
                    key={link.id}
                    data-testid="job-link-chip"
                    className="inline-flex h-7 max-w-[220px] items-center rounded-md border border-border-subtle bg-panel px-2 text-xs text-fg-muted"
                  >
                    <span className="truncate">{link.title}</span>
                  </span>
                ),
              )}
          </div>
          <RouteTabs
            label="Job sections"
            active={tab}
            tabs={tabs.map((id) => ({ id, label: JOB_TAB_LABELS[id], href: routes.jobTab(job.number, id) }))}
          />
        </div>
      }
    >
      {tab === 'overview' ? <JobOverview {...tabProps} /> : null}
      {tab === 'plan' ? <JobPlan {...tabProps} /> : null}
      {tab === 'work' ? <JobWork {...tabProps} /> : null}
      {tab === 'materials' ? <JobMaterials {...tabProps} /> : null}
      {tab === 'money-in' ? <JobMoneyIn {...tabProps} /> : null}
      {tab === 'activity' ? <JobActivity {...tabProps} /> : null}
      {editing ? (
        <EditJobDialog
          job={job}
          jobTypes={jobTypes}
          people={people.data ?? []}
          open
          onOpenChange={(open) => (open ? undefined : setEditing(false))}
          onSaved={refresh}
        />
      ) : null}
      <DeleteJobDialog actions={actions} />
    </Page>
  );
}
