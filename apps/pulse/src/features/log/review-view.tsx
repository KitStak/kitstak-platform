'use client';
/** Review the day: the manager queue. Odd rows in plain words, missing jobs, approve or send back. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  PackageX,
  RefreshCw,
  Undo2,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Select,
  Skeleton,
  Textarea,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { formatLongDate } from '@/lib/dates';
import { formatHours, formatNumber, formatPace } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useLogGrid } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { DayQueueDTO, LaborClassDTO, SiteDTO } from '@/lib/types';
import { markDayCompleteAction, reviewDayAction } from '@/server/actions/log';
import { useReviewQueue } from './floor-hooks';
import { LogGrid } from './log-grid';
import type { PaceThresholds } from './log-math';

type Show = 'todo' | 'approved' | 'all';

const STATUS: Readonly<
  Record<DayQueueDTO['status'], { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }>
> = {
  complete: { label: 'Ready for review', tone: 'info' },
  not_marked: { label: 'Not marked complete', tone: 'neutral' },
  sent_back: { label: 'Sent back', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
};

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

/** One odd row in plain words. Flags hold numbers and ids only, so the words are made here. */
export function flagWords(flag: Readonly<Record<string, unknown>>): string {
  const job = typeof flag.jobNumber === 'string' ? flag.jobNumber : 'A job';
  switch (flag.kind) {
    case 'units_no_hours':
      return `${job} has ${formatNumber(num(flag.units), { maxDigits: 0 })} units but no labor hours. Add the people and hours.`;
    case 'pace_low':
      return `${job} ran at ${formatPace(num(flag.pace))} units per person per hour. The target is ${formatPace(num(flag.target))}. That is under half: check the hours and the units.`;
    case 'pace_high':
      return `${job} ran at ${formatPace(num(flag.pace))} units per person per hour. The target is ${formatPace(num(flag.target))}. That is more than double: look for a typo.`;
    case 'more_hours_than_paid':
      return `More hours are logged (${formatHours(num(flag.loggedHours))}) than were paid (${formatHours(num(flag.paidHours))}). Check the paid hours and the entries.`;
    default:
      return 'A row on this day looks odd. Open the day to check it.';
  }
}

export function ReviewView({
  initial,
  month = null,
  sites,
  laborClasses,
  thresholds,
}: {
  readonly initial: DayQueueDTO[];
  /** A month picked from the month close (`2026-01`): its days are listed instead of the last 21. */
  readonly month?: { readonly value: string; readonly label: string } | null;
  readonly sites: readonly SiteDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly thresholds: PaceThresholds;
}) {
  const [siteId, setSiteId] = useState<string>('all');
  const [show, setShow] = useState<Show>('todo');
  const queue = useReviewQueue(
    month ? { siteId: siteId === 'all' ? null : siteId, month: month.value } : { siteId: siteId === 'all' ? null : siteId, days: 21 },
    { initialData: siteId === 'all' ? initial : undefined },
  );
  const days = useMemo(() => queue.data ?? [], [queue.data]);
  const counts = useMemo(
    () => ({
      todo: days.filter((day) => day.status !== 'approved').length,
      approved: days.filter((day) => day.status === 'approved').length,
    }),
    [days],
  );
  const shown = days.filter((day) =>
    show === 'all' ? true : show === 'approved' ? day.status === 'approved' : day.status !== 'approved',
  );
  const ordered = [...shown].sort((a, b) => {
    const rank = (day: DayQueueDTO) =>
      day.status === 'complete' ? 0 : day.status === 'sent_back' ? 1 : day.status === 'not_marked' ? 2 : 3;
    return rank(a) - rank(b) || b.date.localeCompare(a.date);
  });

  return (
    <div className="flex flex-col gap-4" data-testid="review-view">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          label="Which days to show"
          value={show}
          onValueChange={setShow}
          options={[
            { value: 'todo', label: `To review ${counts.todo}` },
            { value: 'approved', label: `Approved ${counts.approved}` },
            { value: 'all', label: 'All' },
          ]}
        />
        {sites.length > 1 ? (
          <Select
            aria-label="Site"
            className="w-56"
            value={siteId}
            onValueChange={setSiteId}
            options={[
              { value: 'all', label: 'All sites' },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
        ) : null}
        {month ? (
          <span className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
            {`Days in ${month.label}`}
            <Link href={routes.logReview()} className="rounded-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              Show the last 21 days
            </Link>
          </span>
        ) : (
          <span className="ml-auto text-xs text-fg-muted">The last 21 days</span>
        )}
      </div>
      {queue.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the days">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} height={132} className="w-full" rounded="lg" />
          ))}
        </div>
      ) : queue.isError ? (
        <Panel>
          <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-base font-medium text-fg">We could not load the days to review</p>
            <p className="text-sm text-fg-muted">{queue.error.message}</p>
            <Button
              variant="secondary"
              leadingIcon={<RefreshCw aria-hidden />}
              onClick={() => void queue.refetch()}
            >
              Try again
            </Button>
          </div>
        </Panel>
      ) : ordered.length === 0 ? (
        <Panel>
          <Teach
            icon={ClipboardCheck}
            title={show === 'approved' ? `No approved days in ${month ? month.label : 'the last 21 days'}` : month ? `Nothing to review in ${month.label}` : 'Nothing to review'}
            why="When work is logged for a day it lands here. Pulse points out rows that look off, like units with no hours or a pace far from the target, so you can fix them before the numbers are used."
            points={[
              'Units with no hours',
              'Pace under half or over double the target',
              'More hours logged than were paid',
              'Jobs that ran the day before but have nothing today',
            ]}
            actions={<ButtonLink href={routes.log()}>Open today’s log</ButtonLink>}
          />
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordered.map((day) => (
            <li key={`${day.siteId}:${day.date}`}>
              <DayCard
                day={day}
                showSite={sites.length > 1}
                laborClasses={laborClasses}
                thresholds={thresholds}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DayCard({
  day,
  showSite,
  laborClasses,
  thresholds,
}: {
  readonly day: DayQueueDTO;
  readonly showSite: boolean;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly thresholds: PaceThresholds;
}) {
  const shell = useShell();
  const canReview = shell.can('day:review');
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState('');
  const [fixing, setFixing] = useState(false);
  const invalidate = [qk.streams()];
  const review = useServerAction(reviewDayAction, { invalidate });
  const complete = useServerAction(markDayCompleteAction, { invalidate });
  const status = STATUS[day.status];
  const issues = day.flags.length + day.missingJobs.length;
  const flaggedJobs = [
    ...new Set(
      day.flags
        .map((flag) => (typeof flag.jobId === 'string' ? flag.jobId : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const label = `${formatLongDate(day.date)}${showSite ? `, ${day.siteName}` : ''}`;

  async function approve() {
    const before = day.status;
    const done = await review.run({ siteId: day.siteId, date: day.date, decision: 'approve' });
    if (!done) return;
    toast.undo(`Approved ${formatLongDate(day.date)}`, {
      onUndo: async () => {
        await review.run({ siteId: day.siteId, date: day.date, decision: 'reopen' });
        if (before === 'complete') await complete.run({ siteId: day.siteId, date: day.date });
        if (before === 'sent_back' && day.review?.note)
          await review.run({
            siteId: day.siteId,
            date: day.date,
            decision: 'send_back',
            note: day.review.note,
          });
      },
    });
  }

  async function confirmSendBack() {
    const done = await review.run({ siteId: day.siteId, date: day.date, decision: 'send_back', note });
    if (!done) return;
    setSendBack(false);
    setNote('');
    toast.success('Sent back to the floor', 'The day is open again and shows your note.');
  }

  return (
    <article
      aria-label={label}
      data-testid={`review-day-${day.date}`}
      className="rounded-xl border border-border-subtle bg-panel shadow-xs"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-base font-semibold text-fg">{formatLongDate(day.date)}</h2>
          <p className="text-sm text-fg-muted">
            {showSite ? `${day.siteName}. ` : ''}
            {day.jobs} {day.jobs === 1 ? 'job' : 'jobs'}, {formatNumber(day.unitsGood, { maxDigits: 0 })}{' '}
            units, {formatHours(day.hours)} labor hours
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        {day.status !== 'approved' ? (
          issues > 0 ? (
            <Badge tone="warning" icon={<AlertTriangle aria-hidden />}>
              {issues} to check
            </Badge>
          ) : (
            <Badge tone="success" icon={<CheckCircle2 aria-hidden />}>
              Looks right
            </Badge>
          )
        ) : null}
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {day.status === 'sent_back' && day.review?.note ? (
          <p className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-text">
            Sent back with this note: “{day.review.note}”
          </p>
        ) : null}
        {day.flags.length > 0 ? (
          <ul className="flex flex-col gap-1.5" aria-label="Rows that look odd">
            {day.flags.map((flag, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-fg">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
                <span>{flagWords(flag)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {day.missingJobs.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-start gap-2 text-sm text-fg">
              <PackageX aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
              <span>
                {day.missingJobs.length === 1
                  ? 'One job ran the work day before but has nothing logged here.'
                  : `${day.missingJobs.length} jobs ran the work day before but have nothing logged here.`}{' '}
                If they did not run, that is fine.
              </span>
            </p>
            <ul className="ml-6 flex flex-wrap gap-2">
              {day.missingJobs.map((job) => (
                <li key={job.jobId}>
                  <ButtonLink
                    href={routes.log({ date: day.date, site: day.siteId, job: job.jobNumber })}
                    variant="secondary"
                    size="sm"
                  >
                    Log {job.jobNumber}{' '}
                    {job.jobName.length > 28 ? `${job.jobName.slice(0, 28)}…` : job.jobName}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {issues === 0 && day.status !== 'approved' ? (
          <p className="text-sm text-fg-secondary">
            No odd rows and no missing jobs. This day is ready to approve.
          </p>
        ) : null}
        {day.status === 'approved' ? (
          <p className="text-sm text-fg-secondary">
            Approved. The numbers of this day are final unless a manager opens it again.
          </p>
        ) : null}
        {fixing ? (
          <FixInPlace day={day} jobs={flaggedJobs} laborClasses={laborClasses} thresholds={thresholds} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canReview && day.status !== 'approved' && !day.locked ? (
            <Button
              leadingIcon={<CheckCircle2 aria-hidden />}
              onClick={() => void approve()}
              loading={review.pending}
            >
              Approve
            </Button>
          ) : null}
          {canReview && (day.status === 'complete' || day.status === 'not_marked') && !day.locked ? (
            <Button variant="secondary" leadingIcon={<Undo2 aria-hidden />} onClick={() => setSendBack(true)}>
              Send back
            </Button>
          ) : null}
          {canReview && day.status === 'approved' && !day.locked ? (
            <Button
              variant="secondary"
              loading={review.pending}
              onClick={() =>
                void review.run({ siteId: day.siteId, date: day.date, decision: 'reopen' }).then(() => {
                  toast.success('The day is open again');
                })
              }
            >
              Open again
            </Button>
          ) : null}
          {flaggedJobs.length > 0 && day.status !== 'approved' && !day.locked ? (
            <Button
              variant="secondary"
              leadingIcon={<Wrench aria-hidden />}
              onClick={() => setFixing((open) => !open)}
              pressed={fixing}
            >
              {fixing ? 'Hide the rows' : 'Fix rows here'}
            </Button>
          ) : null}
          <ButtonLink
            href={routes.log({ date: day.date, site: day.siteId })}
            variant="tertiary"
            icon={<ExternalLink aria-hidden />}
          >
            Open the day
          </ButtonLink>
          {day.locked ? <span className="text-xs text-fg-muted">This month is closed.</span> : null}
        </div>
      </div>
      <Dialog open={sendBack} onOpenChange={setSendBack}>
        <DialogContent size="sm">
          <DialogHeader
            title="Send this day back"
            description={`${label}. The floor can change the day again and sees your note at the top.`}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmSendBack();
            }}
          >
            <DialogBody>
              <Field label="What needs fixing" required error={review.fieldErrors.note ?? null}>
                {({ inputId, invalid }) => (
                  <Textarea
                    id={inputId}
                    invalid={invalid}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="J-1012 shows units but no hours. Please add the crew."
                    autoFocus
                  />
                )}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="tertiary" onClick={() => setSendBack(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={review.pending} disabled={!note.trim()}>
                Send back
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function FixInPlace({
  day,
  jobs,
  laborClasses,
  thresholds,
}: {
  readonly day: DayQueueDTO;
  readonly jobs: readonly string[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly thresholds: PaceThresholds;
}) {
  const shell = useShell();
  const grid = useLogGrid({ date: day.date, siteId: day.siteId }, { placeholderData: undefined });
  if (grid.isLoading) return <Skeleton height={72} className="w-full" />;
  if (grid.isError || !grid.data)
    return (
      <p role="alert" className="text-sm text-danger-text">
        We could not load the rows. Use “Open the day” to fix them there.
      </p>
    );
  return (
    <div className="rounded-lg border border-border-subtle bg-app py-2">
      <LogGrid
        key={`${day.siteId}:${day.date}`}
        grid={grid.data}
        laborClasses={laborClasses}
        thresholds={thresholds}
        seesMoney={shell.seesMoney}
        filter=""
        onlyJobs={jobs}
      />
    </div>
  );
}
