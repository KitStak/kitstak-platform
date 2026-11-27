'use client';

/**
 * Handheld / RF count execution (`/counts/scan`, Logiwa mobile "Count" + "Instant Count").
 * Built for a 360-480px scanner screen with large touch targets and a wedge scanner:
 *   1. "Your jobs" (count jobs assigned to me), "Job pool" (unassigned jobs, Take job) and
 *      "Plans" (scan or tap a plan that is Ready to Count / Count Started), as Logiwa mobile
 *      Cycle Count splits the work.
 *   2. The Count Sheet runs in handheld layout: scan location, enter qty per SKU / lot, submit;
 *      the next location is then ready. Blind-count jobs hide the system quantities.
 * "Instant" opens the Instant Count flow for an unplanned location.
 * Execution uses the same `POST /api/counts/[id]/sheet` endpoint as the desktop sheet, so
 * permissions (counts edit / mobile cycle count), scope, audit and ledger rules are identical.
 */
import * as React from 'react';
import { Meter } from '@kitstak/ui/dashboard';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, ClipboardList, Hand, Inbox, ScanLine, User, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { COUNT_EXECUTE_PERMISSIONS, COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DisabledReason } from '@/components/ui/tooltip';
import { FieldError } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { CountStatusPill } from './count-status-pill';
import { TextField } from '@/components/ui/text-field';
import { CountSheet } from './count-sheet';
import type { CountPlanRow } from './counts-columns';
import { errorMessage, useCountCan, useRefreshCounts, COUNT_QUERY_TIMEOUT_MS } from './counts-client';
import { InstantCountModal } from './instant-count-modal';

const OPEN_STATUSES = ['Ready To Count', 'Count Started'];

export function CountScanPage() {
  const router = useRouter();
  const search = useSearchParams();
  const planCode = search.get('plan');
  const canExecute = useCountCan(COUNT_EXECUTE_PERMISSIONS, 'any').allowed;
  const canInstant = useCountCan([P.create, P.mobileInstant], 'any').allowed;
  const [instant, setInstant] = React.useState(false);
  const refresh = useRefreshCounts();

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 pb-10 pt-4">
      <header className="flex items-center gap-2">
        {planCode ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11"
            onClick={() => router.push('/counts/scan')}
            aria-label="Back to count jobs"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground">{planCode ?? 'Count'}</h1>
          <p className="text-xs text-secondary">
            {planCode
              ? 'Scan a location, enter what is on the shelf, submit.'
              : 'Open one of your jobs, take one from the pool, or scan a count plan.'}
          </p>
        </div>
        {canInstant ? (
          <Button variant="secondary" className="h-11" onClick={() => setInstant(true)}>
            <Zap className="h-4 w-4" aria-hidden />
            Instant
          </Button>
        ) : null}
      </header>
      {!canExecute ? (
        <Callout variant="attention" title="View only">
          Your role can see count plans but cannot enter counts. Ask a manager for the counts execute or
          mobile cycle count permission.
        </Callout>
      ) : null}
      {planCode ? (
        <PlanSheet code={planCode} canExecute={canExecute} onSubmitted={() => void refresh()} />
      ) : (
        <WorkChooser
          canExecute={canExecute}
          onPick={(code) => router.push(`/counts/scan?plan=${encodeURIComponent(code)}`)}
        />
      )}
      <InstantCountModal open={instant} onOpenChange={setInstant} onDone={() => void refresh()} />
    </div>
  );
}

/* ------------------------------------------------------------ job views */
type WorkView = 'mine' | 'pool' | 'plans';

interface ScanJob {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly priority: string;
  readonly planCode: string;
  readonly planStatus: string;
  readonly warehouseCode: string;
  readonly assigneeName: string | null;
  readonly taskCount: number;
  readonly doneCount: number;
  readonly nextLocations: string | null;
  readonly remainingLocations: number;
}

/**
 * Your jobs / Job pool / Plans. Tabs are real ARIA tabs (arrow keys move, each controls its panel),
 * 44 px tall for gloved thumbs. The view is kept in `?view=` so Back returns to the same list.
 */
function WorkChooser({
  canExecute,
  onPick,
}: {
  readonly canExecute: boolean;
  readonly onPick: (code: string) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const canMine = useCountCan([P.mobileYourJobs, P.edit, P.updateInv], 'any').allowed;
  const canPool = useCountCan([P.mobileJobPool, P.edit, P.updateInv], 'any').allowed;
  const views: { key: WorkView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    ...(canMine ? [{ key: 'mine' as const, label: 'Your jobs', icon: User }] : []),
    ...(canPool ? [{ key: 'pool' as const, label: 'Job pool', icon: Inbox }] : []),
    { key: 'plans', label: 'Plans', icon: ClipboardList },
  ];
  const asked = search.get('view') as WorkView | null;
  const view: WorkView = views.some((v) => v.key === asked)
    ? (asked as WorkView)
    : (views[0]?.key ?? 'plans');
  const setView = (v: WorkView) => router.replace(`/counts/scan?view=${v}`, { scroll: false });
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = views.length;
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    const v = views[next];
    if (!v) return;
    setView(v.key);
    tabRefs.current[v.key]?.focus();
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Count work"
        className="grid gap-1 rounded-lg bg-neutral-soft p-1"
        style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}
      >
        {views.map((v, i) => {
          const active = v.key === view;
          const Icon = v.icon;
          return (
            <button
              key={v.key}
              ref={(el) => {
                tabRefs.current[v.key] = el;
              }}
              type="button"
              role="tab"
              id={`scan-tab-${v.key}`}
              aria-selected={active}
              aria-controls={`scan-panel-${v.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setView(v.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                active ? 'bg-surface text-foreground shadow-xs' : 'text-secondary hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{v.label}</span>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`scan-panel-${view}`}
        aria-labelledby={`scan-tab-${view}`}
        className="flex flex-col gap-3"
      >
        {view === 'plans' ? (
          <PlanChooser onPick={onPick} />
        ) : (
          <JobList view={view} canExecute={canExecute} onOpen={onPick} onTaken={() => setView('mine')} />
        )}
      </div>
    </div>
  );
}

/**
 * Why an open count job is missing from Your jobs / Job pool: it is assigned to another counter.
 * Lists those jobs with their assignee (read-only; a supervisor reassigns them on the job page).
 */
function AssignedElsewhere() {
  const others = useApiQuery<ScanJob[]>(['count-scan-jobs', 'others'], '/api/counts/scan-jobs', {
    query: { view: 'others' },
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
    retry: false,
  });
  const rows = others.data?.data ?? [];
  if (others.isPending || others.error || rows.length === 0) return null;
  return (
    <section
      aria-label="Count jobs assigned to other counters"
      className="rounded-lg border border-border bg-surface px-4 py-3"
      data-testid="assigned-elsewhere"
    >
      <p className="text-sm font-semibold text-foreground">
        {rows.length === 1 ? '1 open count job is' : `${rows.length} open count jobs are`} assigned to other
        counters
      </p>
      <p className="mt-0.5 text-xs text-secondary">
        They are not in the pool because someone already has them. A supervisor can reassign a job from its
        job page.
      </p>
      <ul className="mt-2 flex flex-col divide-y divide-border">
        {rows.map((j) => (
          <li key={j.id} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              <a
                href={`/jobs/${encodeURIComponent(j.id)}`}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {j.code}
              </a>
              <span className="text-secondary">
                {' '}
                · {j.planCode} · {j.doneCount}/{j.taskCount} tasks
              </span>
            </span>
            <span className="shrink-0 truncate text-secondary">
              Assigned to{' '}
              <strong className="font-semibold text-foreground">{j.assigneeName ?? 'another user'}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobList({
  view,
  canExecute,
  onOpen,
  onTaken,
}: {
  readonly view: 'mine' | 'pool';
  readonly canExecute: boolean;
  readonly onOpen: (planCode: string) => void;
  readonly onTaken: () => void;
}) {
  const qc = useQueryClient();
  const jobs = useApiQuery<ScanJob[]>(['count-scan-jobs', view], '/api/counts/scan-jobs', {
    query: { view },
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
  });
  const [taking, setTaking] = React.useState<string | null>(null);
  const rows = jobs.data?.data ?? [];
  const take = async (job: ScanJob) => {
    setTaking(job.id);
    try {
      await apiFetch('/api/counts/scan-jobs/take', { method: 'POST', body: { jobId: job.id } });
      toast.success('Job taken', `${job.code} is now in Your jobs.`);
      await qc.invalidateQueries({ queryKey: ['count-scan-jobs'] });
      onTaken();
    } catch (error) {
      toast.error('Could not take the job', errorMessage(error));
      void jobs.refetch();
    } finally {
      setTaking(null);
    }
  };
  if (jobs.isPending)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  if (jobs.error)
    return (
      <Callout
        variant="error"
        title="Count jobs could not be loaded"
        action={
          <Button size="sm" variant="secondary" onClick={() => void jobs.refetch()}>
            Retry
          </Button>
        }
      >
        {jobs.error.message}
      </Callout>
    );
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
          {view === 'mine' ? (
            <User className="h-6 w-6 text-faint" aria-hidden />
          ) : (
            <Inbox className="h-6 w-6 text-faint" aria-hidden />
          )}
          <p className="text-sm font-semibold text-foreground">
            {view === 'mine' ? 'No count jobs assigned to you' : 'The job pool is empty'}
          </p>
          <p className="text-xs text-secondary">
            {view === 'mine'
              ? 'Take a job from the job pool, or ask a supervisor to assign one.'
              : 'The pool lists only unassigned jobs of Ready to Count and Count Started plans. New unassigned jobs show here.'}
          </p>
        </div>
        <AssignedElsewhere />
      </div>
    );
  }
  return (
    <ul
      className="flex flex-col gap-2"
      aria-label={view === 'mine' ? 'Your count jobs' : 'Unassigned count jobs'}
    >
      {rows.map((j) => {
        const pct = j.taskCount ? Math.round((j.doneCount / j.taskCount) * 100) : 0;
        const body = (
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-base font-semibold text-foreground">{j.code}</span>
              {j.priority && j.priority !== 'None' ? (
                <span className="shrink-0 rounded bg-warning-soft px-1.5 py-px text-2xs font-semibold text-warning">
                  {j.priority}
                </span>
              ) : null}
            </span>
            <span className="truncate text-xs text-secondary">
              {j.planCode} · {j.warehouseCode} · {j.doneCount}/{j.taskCount} tasks
            </span>
            {j.nextLocations ? (
              <span className="truncate text-xs text-secondary">
                Next: <strong className="font-semibold text-foreground">{j.nextLocations}</strong>
                {j.remainingLocations > 3 ? ` +${j.remainingLocations - 3}` : ''}
              </span>
            ) : null}
            <span className="mt-0.5 block w-full">
              <Meter value={pct / 100} label={`${j.code} progress`} />
            </span>
          </span>
        );
        return (
          <li
            key={j.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3"
          >
            {view === 'mine' ? (
              <button
                type="button"
                onClick={() => onOpen(j.planCode)}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={`Count ${j.code} (${j.planCode})`}
              >
                {body}
                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </button>
            ) : (
              <>
                {body}
                <DisabledReason reason={canExecute ? null : "Your role can't enter counts"}>
                  <Button
                    variant="primary"
                    className="h-11 shrink-0"
                    disabled={!canExecute || taking !== null}
                    onClick={() => void take(j)}
                    aria-label={`Take job ${j.code}`}
                  >
                    {taking === j.id ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <Hand className="h-4 w-4" aria-hidden />
                    )}
                    Take job
                  </Button>
                </DisabledReason>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PlanChooser({ onPick }: { readonly onPick: (code: string) => void }) {
  const [scan, setScan] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const plans = useApiQuery<CountPlanRow[]>(['count-scan-plans'], '/api/counts', {
    query: { 'f.status': `in:${OPEN_STATUSES.join(',')}`, ps: 50 },
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
  });
  const rows = plans.data?.data ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) {
      setError('Scan or type a count plan code');
      return;
    }
    const hit = rows.find((r) => r.code.toLowerCase() === code.toLowerCase());
    if (!hit && !plans.isPending) {
      setError(`${code} is not ready to count`);
      return;
    }
    setError(null);
    onPick(hit?.code ?? code);
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="flex flex-col gap-1">
        <label htmlFor="scan-plan" className="text-xs font-semibold text-foreground">
          Count plan
        </label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              id="scan-plan"
              autoFocus
              autoComplete="off"
              value={scan}
              onChange={(e) => {
                setScan(e.target.value);
                setError(null);
              }}
              placeholder="Scan count plan code"
              className="h-12 text-base"
              invalid={Boolean(error)}
              aria-describedby={error ? 'scan-plan-err' : undefined}
              leading={<ScanLine className="h-5 w-5 text-faint" aria-hidden />}
            />
          </div>
          <Button type="submit" variant="primary" className="h-12 px-5">
            Go
          </Button>
        </div>
        <FieldError id="scan-plan-err" message={error ?? undefined} />
      </form>
      <section aria-label="Plans ready to count" className="flex flex-col gap-2">
        <h2 className="text-2xs font-semibold text-faint">Ready to count</h2>
        {plans.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : plans.error ? (
          <Callout
            variant="error"
            title="Count plans could not be loaded"
            action={
              <Button size="sm" variant="secondary" onClick={() => void plans.refetch()}>
                Retry
              </Button>
            }
          >
            {plans.error.message}
          </Callout>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
            <ClipboardList className="h-6 w-6 text-faint" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Nothing to count right now</p>
            <p className="text-xs text-secondary">
              Plans show here once a manager creates their count job. Use Instant to count a location on the
              spot.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.code)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-foreground">{r.code}</span>
                    <span className="block text-xs text-secondary">
                      {r.warehouseCode} · {r.countType} · {r.countedLineCount}/{r.lineCount} counted
                    </span>
                  </span>
                  <CountStatusPill status={r.status} domain="count" size="sm" />
                  <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface PlanHead {
  readonly plan: {
    readonly id: string;
    readonly code: string;
    readonly status: string;
    readonly warehouseId: string;
  };
}

function PlanSheet({
  code,
  canExecute,
  onSubmitted,
}: {
  readonly code: string;
  readonly canExecute: boolean;
  readonly onSubmitted: () => void;
}) {
  const detail = useApiQuery<PlanHead>(['count-plan', code], `/api/counts/${encodeURIComponent(code)}`, {
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
  });
  const plan = detail.data?.data.plan;
  if (detail.isPending)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (detail.error || !plan) {
    return (
      <Callout
        variant="error"
        title="Count plan not found"
        action={
          <Link href="/counts/scan" className="text-xs font-semibold text-primary hover:underline">
            Pick another plan
          </Link>
        }
      >
        {detail.error?.message ?? `${code} does not exist or is outside your warehouses.`}
      </Callout>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CountStatusPill status={plan.status} domain="count" />
        <Link
          href={`/counts/${encodeURIComponent(plan.code)}`}
          className="ml-auto text-xs font-semibold text-primary hover:underline"
        >
          Desktop view
        </Link>
      </div>
      <CountSheet
        planId={plan.id}
        planCode={plan.code}
        planStatus={plan.status}
        warehouseId={plan.warehouseId}
        canExecute={canExecute}
        onSubmitted={() => {
          onSubmitted();
          void detail.refetch();
        }}
      />
    </div>
  );
}
