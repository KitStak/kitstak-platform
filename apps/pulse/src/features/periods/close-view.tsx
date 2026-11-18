'use client';
/**
 * Month close: pick a month, walk its checklist, then lock it. A closed month refuses every
 * change to entries dated in it until an owner reopens it with a reason. Every close and reopen
 * is kept in the history at the bottom, which nobody can edit.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CircleAlert, CircleCheck, History, Lock, LockOpen, TriangleAlert } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Skeleton, Tabs, TabsList, TabsTrigger, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { ButtonLink } from '@/components/pulse/button-link';
import { formatMoment, useHydrated } from '@/components/pulse/local-time';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { CostLedger } from '@/features/costs/cost-ledger';
import { MaterialLedger } from '@/features/materials/material-ledger';
import { RevenueLedger } from '@/features/revenue/revenue-ledger';
import { ServiceLedger } from '@/features/revenue/service-ledger';
import { useShell } from '@/features/shell/shell-context';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatMoney, formatMoneyWhole, formatNumber, formatPercentBp } from '@/lib/format';
import { endOfMonth } from '@/lib/profit/calendar';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { closePeriodAction, reopenPeriodAction } from '@/server/actions/planning';
import type { CloseBoardDTO, CloseDetailDTO, CloseEventDTO, CloseItemDTO, CloseMonthDTO } from '@/server/domain/period-ops';
import { bridgeSteps, closableFrom } from './close-model';

const keys = {
  board: () => ['periods', 'board'] as const,
  detail: (month: string) => ['periods', 'detail', month.slice(0, 7)] as const,
  events: () => ['periods', 'events'] as const,
};

const ITEM_ICON = { ok: CircleCheck, fix: CircleAlert, check: TriangleAlert } as const;
const ITEM_TONE = { ok: 'text-success', fix: 'text-danger-text', check: 'text-warning-text' } as const;
const ITEM_WORD = { ok: 'Done', fix: 'Fix this first', check: 'Worth a look' } as const;

const money = (cents: number | null, hidden: boolean): string => (cents === null ? (hidden ? 'Hidden' : 'No numbers yet') : Math.abs(cents) >= 1_000_000 ? formatMoneyWhole(cents) : formatMoney(cents));

export function CloseView({
  initialBoard,
  initialMonth,
  initialDetail,
  initialEvents,
}: {
  readonly initialBoard: CloseBoardDTO;
  readonly initialMonth: string | null;
  readonly initialDetail: CloseDetailDTO | null;
  readonly initialEvents: readonly CloseEventDTO[];
}) {
  const router = useRouter();
  const shell = useShell();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(initialMonth);
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  // Close and reopen times are shown in the reader's time zone, once the page is live (UTC before, to match the server).
  const local = useHydrated();

  const boardQuery = useQuery({ queryKey: keys.board(), queryFn: () => apiGet<CloseBoardDTO>(apiPath('periods/board')), initialData: initialBoard, staleTime: 30_000 });
  const detailQuery = useQuery({
    queryKey: keys.detail(month ?? ''),
    queryFn: () => apiGet<CloseDetailDTO>(apiPath(`periods/${(month ?? '').slice(0, 7)}/detail`)),
    enabled: Boolean(month),
    initialData: month && month === initialMonth && initialDetail ? initialDetail : undefined,
    staleTime: 30_000,
  });
  const eventsQuery = useQuery({ queryKey: keys.events(), queryFn: () => apiGet<CloseEventDTO[]>(apiPath('periods/events')), initialData: [...initialEvents], staleTime: 30_000 });

  const board = boardQuery.data;
  const selected = board.months.find((item) => item.periodMonth === month) ?? null;
  const detail = detailQuery.data ?? null;

  const pick = (next: string) => {
    setMonth(next);
    router.replace(`${routes.settingsClose()}?month=${next.slice(0, 7)}`, { scroll: false });
  };
  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: qk.periods() }), queryClient.invalidateQueries({ queryKey: qk.streams() })]);
    router.refresh();
  };

  const close = async (target: CloseMonthDTO): Promise<string | null> => {
    const result = await closePeriodAction({ month: target.periodMonth });
    if (!result.ok) return result.error.message;
    setDialog(null);
    await refresh();
    const message = `${target.label} is closed`;
    if (board.canReopen) {
      toast.undo(message, {
        description: 'Its entries are locked.',
        onUndo: async () => {
          const undone = await reopenPeriodAction({ month: target.periodMonth, reason: 'Closed by mistake and opened again right away.' });
          if (!undone.ok) throw new Error(undone.error.message);
          await refresh();
        },
      });
    } else toast.success(message, 'Its entries are locked.');
    return null;
  };
  const reopen = async (target: CloseMonthDTO, reason: string): Promise<string | null> => {
    const result = await reopenPeriodAction({ month: target.periodMonth, reason });
    if (!result.ok) return result.error.message;
    setDialog(null);
    await refresh();
    toast.undo(`${target.label} is open again`, {
      description: 'Entries in it can change.',
      onUndo: async () => {
        const undone = await closePeriodAction({ month: target.periodMonth });
        if (!undone.ok) throw new Error(undone.error.message);
        await refresh();
      },
    });
    return null;
  };

  if (board.months.length === 0) {
    return (
      <section className="rounded-xl border border-border-subtle bg-panel shadow-xs">
        <Teach
          icon={CalendarCheck2}
          title="No months to close yet"
          why="Closing a month locks its numbers. After that nobody can change an entry, a cost or a rate inside it by accident, so the profit you reported stays the profit you reported."
          points={['A checklist: every hour has a rate, every day has hours, payroll checked', 'One click to close, with who did it and when', 'An owner can reopen a month, with a reason that is kept on record']}
          actions={shell.can('production:log') ? <ButtonLink href={routes.log()}>Log work</ButtonLink> : <ButtonLink href={routes.jobs()}>Open jobs</ButtonLink>}
          footnote={board.canClose ? 'A month shows up here once it has at least one logged day.' : 'Only an admin or owner can close a month.'}
          testId="close-empty"
        />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="close">
      {boardQuery.isError ? <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-text">We could not refresh the list of months. You are looking at the last one we loaded.</p> : null}
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Months" className="min-w-0">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" data-testid="close-months">
            {board.months.map((item) => {
              const active = item.periodMonth === month;
              return (
                <li key={item.periodMonth} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => pick(item.periodMonth)}
                    aria-current={active ? 'true' : undefined}
                    data-testid={`close-month-${item.periodMonth.slice(0, 7)}`}
                    className={cn(
                      'flex w-full min-w-[180px] flex-col gap-1 rounded-xl border bg-panel px-3.5 py-3 text-left shadow-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                      active ? 'border-primary ring-1 ring-[color:var(--primary)]' : 'border-border-subtle',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{item.label}</span>
                      <MonthBadge month={item} />
                    </span>
                    <span className="text-xs text-fg-muted tabular-nums">
                      {board.moneyHidden ? (item.status === 'closed' ? `Closed ${formatMoment(item.closedAt, 'day', local)}` : 'Open') : item.companyProfitCents === null ? 'No numbers yet' : `Company profit ${formatMoneyWhole(item.companyProfitCents)} · ${formatPercentBp(item.companyMarginBp, { empty: 'no margin' })}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          {!selected ? null : detailQuery.isLoading || !detail ? (
            detailQuery.isError ? (
              <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-border-subtle bg-panel p-4 text-sm text-danger-text">
                We could not load {selected.label}. {detailQuery.error instanceof Error ? detailQuery.error.message : ''}
                <Button variant="secondary" size="sm" onClick={() => void detailQuery.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <div role="status" aria-busy="true" className="flex flex-col gap-3">
                <span className="sr-only">Loading the month</span>
                <Skeleton height={120} rounded="lg" />
                <Skeleton height={320} rounded="lg" />
              </div>
            )
          ) : (
            <>
              <MonthHeader month={selected} detail={detail} board={board} onClose={() => setDialog('close')} onReopen={() => setDialog('reopen')} />
              <Checklist detail={detail} closed={selected.status === 'closed'} />
              <section aria-labelledby="close-locks" className="rounded-xl border border-border-subtle bg-panel shadow-xs">
                <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                  <Lock aria-hidden className="size-4 text-icon" />
                  <h3 id="close-locks" className="text-base font-semibold text-fg">
                    {selected.status === 'closed' ? 'What is locked' : 'What a close locks'}
                  </h3>
                </header>
                <div className="p-4">
                  <p className="text-sm text-fg-secondary" data-testid="close-lock-total">
                    {detail.totalRows === 0
                      ? `Nothing is dated in ${detail.label} yet.`
                      : `${formatNumber(detail.totalRows)} ${detail.totalRows === 1 ? 'row is' : 'rows are'} dated in ${detail.label}. ${selected.status === 'closed' ? 'They cannot be added to, changed or deleted.' : 'After a close they cannot be added to, changed or deleted, by hand or by an import.'}`}
                  </p>
                  <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    {detail.locks.map((lock) => (
                      <div key={lock.label} className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1">
                        <dt className="text-fg-secondary">{lock.label}</dt>
                        <dd className="font-medium text-fg tabular-nums">{formatNumber(lock.count)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>
            </>
          )}

        </div>
      </div>

      {selected && detail ? <MonthEntries month={selected} today={board.today} moneyHidden={board.moneyHidden} /> : null}

      <section aria-labelledby="close-history" className="rounded-xl border border-border-subtle bg-panel shadow-xs">
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <History aria-hidden className="size-4 text-icon" />
          <h3 id="close-history" className="text-base font-semibold text-fg">
            History
          </h3>
        </header>
        {eventsQuery.data.length === 0 ? (
          <p className="p-4 text-sm text-fg-secondary">No month has been closed yet. When one is, you will see who closed it and when. Nobody can edit this list.</p>
        ) : (
          <ol className="divide-y divide-border-subtle" data-testid="close-history-list">
            {eventsQuery.data.map((event) => (
              <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', event.action === 'closed' ? 'bg-muted text-icon-strong' : 'bg-warning-subtle text-warning-text')}>
                  {event.action === 'closed' ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="text-fg">
                    <span className="font-medium">{event.actorName ?? 'Someone'}</span> {event.action === 'closed' ? 'closed' : 'reopened'} <span className="font-medium">{event.monthLabel}</span>
                  </p>
                  {event.reason ? <p className="mt-0.5 text-fg-secondary">Reason: {event.reason}</p> : null}
                  <p className="mt-0.5 text-xs text-fg-muted">{formatMoment(event.at, 'dayTime', local)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted">
          Every close and reopen is also in the{' '}
          <Link href={routes.settingsAudit()} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            audit log
          </Link>
          .
        </p>
      </section>

      {dialog === 'close' && selected && detail ? <CloseDialog month={selected} detail={detail} onCancel={() => setDialog(null)} onConfirm={() => close(selected)} /> : null}
      {dialog === 'reopen' && selected ? <ReopenDialog month={selected} onCancel={() => setDialog(null)} onConfirm={(reason) => reopen(selected, reason)} /> : null}
    </div>
  );
}

type EntryTab = 'company' | 'costs' | 'parts' | 'money' | 'services';
const ENTRY_TABS: readonly { readonly id: EntryTab; readonly label: string; readonly money: boolean }[] = [
  { id: 'company', label: 'Company costs', money: true },
  { id: 'costs', label: 'All other costs', money: true },
  { id: 'parts', label: 'Parts used', money: false },
  { id: 'money', label: 'Invoices and fees', money: true },
  { id: 'services', label: 'Extra services', money: false },
];

/** The entries dated in the month, to look over (and fix) before the month is locked. */
function MonthEntries({ month, today, moneyHidden }: { readonly month: CloseMonthDTO; readonly today: string; readonly moneyHidden: boolean }) {
  const tabs = ENTRY_TABS.filter((tab) => !(moneyHidden && tab.money));
  const [tab, setTab] = useState<EntryTab>(tabs[0]?.id ?? 'parts');
  // The checklist links here with #company-costs: open that tab when the link is used.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#company-costs' && !moneyHidden) setTab('company');
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [moneyHidden]);
  const from = month.periodMonth;
  const to = endOfMonth(month.periodMonth);
  const day = today <= to && today >= from ? today : to;
  return (
    <section id="company-costs" aria-labelledby="close-entries" className="flex scroll-mt-4 flex-col gap-3" data-testid="close-entries">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="close-entries" className="text-base font-semibold text-fg">
          Entries dated in {month.label}
        </h3>
        <Tabs value={tab} onValueChange={(value) => setTab(value as EntryTab)}>
          <TabsList variant="pill" aria-label="Kind of entry" className="max-w-full overflow-x-auto">
            {tabs.map((item) => (
              <TabsTrigger key={item.id} value={item.id} variant="pill" className="shrink-0 whitespace-nowrap" data-testid={`close-entries-${item.id}`}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {month.status === 'closed' ? <p className="text-sm text-fg-secondary">{month.label} is closed, so these rows are locked. Reopen the month to change one.</p> : null}
      {tab === 'company' ? <CostLedger scope="company" today={day} from={from} to={to} title="Company costs" /> : null}
      {tab === 'costs' ? <CostLedger scope="all" today={day} from={from} to={to} title="Other costs, every job and client" /> : null}
      {tab === 'parts' ? <MaterialLedger today={day} from={from} to={to} /> : null}
      {tab === 'money' ? <RevenueLedger today={day} from={from} to={to} /> : null}
      {tab === 'services' ? <ServiceLedger today={day} from={from} to={to} /> : null}
    </section>
  );
}

function MonthBadge({ month }: { readonly month: CloseMonthDTO }) {
  if (month.status === 'closed')
    return (
      <Badge tone="neutral" icon={<Lock aria-hidden />}>
        Closed
      </Badge>
    );
  if (month.inProgress) return <Badge tone="primary">In progress</Badge>;
  return <Badge tone="warning">Ready to close</Badge>;
}

function MonthHeader({ month, detail, board, onClose, onReopen }: { readonly month: CloseMonthDTO; readonly detail: CloseDetailDTO; readonly board: CloseBoardDTO; readonly onClose: () => void; readonly onReopen: () => void }) {
  const closed = month.status === 'closed';
  // A closed month shows the numbers it was closed with. An open one shows live numbers.
  const local = useHydrated();
  const hidden = board.moneyHidden;
  const percent = (bp: number | null): string => (bp === null ? (hidden ? 'Hidden' : 'No revenue yet') : formatPercentBp(bp));
  const steps = bridgeSteps(detail.bridge);
  const hasNumbers = !hidden && detail.profitCents !== null && detail.companyProfitCents !== null;
  return (
    <section aria-labelledby="close-month-title" className="rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="close-detail" data-status={month.status}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 id="close-month-title" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.01em] text-fg">
            {month.label}
            <MonthBadge month={month} />
          </h2>
          <p className="mt-1 text-sm text-fg-secondary" data-testid="close-status-line">
            {closed
              ? `Closed${month.closedByName ? ` by ${month.closedByName}` : ''} on ${formatMoment(month.closedAt, 'day', local)}. Entries dated in ${month.label} cannot change.`
              : month.inProgress
                ? `${month.label} is not over yet. You can close it from ${closableFrom(month.periodMonth)}.`
                : detail.ready
                  ? 'The checklist is clear. Close the month to lock its numbers.'
                  : `${detail.toFix} ${detail.toFix === 1 ? 'step needs' : 'steps need'} fixing before these numbers can be trusted.`}
          </p>
          {!closed && month.reopenedAt ? (
            <p className="mt-1 text-sm text-fg-secondary">
              Reopened{month.reopenedByName ? ` by ${month.reopenedByName}` : ''} on {formatMoment(month.reopenedAt, 'day', local)}
              {month.reopenReason ? `: ${month.reopenReason}` : '.'}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {closed ? (
            board.canReopen ? (
              <Button variant="secondary" leadingIcon={<LockOpen aria-hidden />} onClick={onReopen} data-testid="close-reopen">
                Reopen the month
              </Button>
            ) : (
              <p className="max-w-[220px] text-right text-xs text-fg-muted">Only the owner of the workspace can reopen a month.</p>
            )
          ) : board.canClose ? (
            <Button leadingIcon={<Lock aria-hidden />} onClick={onClose} disabled={month.inProgress} data-testid="close-button">
              Close the month
            </Button>
          ) : (
            <p className="max-w-[220px] text-right text-xs text-fg-muted">Only an admin or owner can close a month.</p>
          )}
        </div>
      </header>

      {/* Job profit on the left, company profit on the right, and the costs no job carried in between. */}
      <div className="mt-4 grid gap-px overflow-hidden rounded-b-xl border-t border-border-subtle bg-[color:var(--border-subtle)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]" data-testid="close-numbers">
        <dl className="flex flex-col gap-3 bg-panel px-4 py-3" data-testid="close-job-side">
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Revenue" value={money(detail.revenueCents, hidden)} />
            <Figure label="Job cost" value={money(detail.costCents, hidden)} testId="close-job-cost" />
          </div>
          <Figure
            label="Job profit"
            value={money(detail.profitCents, hidden)}
            sub={<>Job margin <span className="font-medium text-fg tabular-nums" data-testid="close-job-margin">{percent(detail.marginBp)}</span></>}
            testId="close-job-profit"
            strong
            how={
              hasNumbers ? (
                <How
                  title={`Job profit in ${month.label}`}
                  formula={`${detail.saved ? 'These are the numbers saved at the moment the month was closed. ' : ''}Revenue earned in the month, less the cost of its jobs: labor, material, other costs and the time not on a job that jobs carried. Job margin is job profit as a share of revenue. Overhead and paid time not on any job are not in it.`}
                  lines={[
                    { label: 'Revenue', value: money(detail.revenueCents, hidden), op: 'start' },
                    { label: 'Job cost', value: money(detail.costCents, hidden), op: 'minus' },
                    { label: 'Job profit', value: money(detail.profitCents, hidden), op: 'total' },
                    { label: 'Job margin', value: percent(detail.marginBp), op: 'note' },
                  ]}
                  warnings={!closed && !detail.ready ? detail.items.filter((item) => item.state === 'fix').map((item) => item.detail) : []}
                  align="start"
                />
              ) : null
            }
          />
        </dl>

        <div className="bg-panel px-4 py-3" data-testid="close-bridge">
          <p className="flex h-6 items-center text-xs text-fg-muted">From job profit to company profit</p>
          {hidden ? (
            <p className="mt-1 text-sm text-fg-secondary">Money is hidden for your role.</p>
          ) : !hasNumbers ? (
            <p className="mt-1 text-sm text-fg-secondary">No numbers yet.</p>
          ) : (
            <>
              <ul className="mt-1 flex flex-col text-sm">
                {steps.map((step) => (
                  <li key={step.key} className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5" data-testid={`close-bridge-${step.key}`}>
                    <span className="min-w-0 text-fg-secondary">{step.label}</span>
                    <span className={cn('shrink-0 font-medium tabular-nums', step.adds ? 'text-success-text' : 'text-fg')}>
                      <span className="font-normal text-fg-muted">{step.adds ? 'plus ' : 'less '}</span>
                      {formatMoney(Math.abs(step.cents))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-fg-muted">
                {detail.bridge.hasCompanyCosts
                  ? 'No job carried these costs, so they come off after job profit.'
                  : `No company costs are typed in for ${month.label}, so Pulse trusts the overhead inside your hourly rates.`}
              </p>
            </>
          )}
        </div>

        <dl className="flex flex-col justify-end gap-3 bg-panel px-4 py-3" data-testid="close-company-side">
          <Figure
            label="Company profit"
            value={money(detail.companyProfitCents, hidden)}
            sub={<>Company margin <span className="font-medium text-fg tabular-nums" data-testid="close-company-margin">{percent(detail.companyMarginBp)}</span></>}
            testId="close-company-profit"
            strong
            tone={(detail.companyProfitCents ?? 0) < 0 ? 'bad' : undefined}
            how={
              hasNumbers ? (
                <How
                  title={`Company profit in ${month.label}`}
                  formula={`${detail.saved ? 'These are the numbers saved at the moment the month was closed. ' : ''}Company profit starts from job profit and takes away the costs no job carried. Company margin is company profit as a share of revenue. This is the number to report for the month.`}
                  lines={[
                    { label: 'Job profit', value: money(detail.profitCents, hidden), op: 'start' },
                    ...steps.map((step) => ({ label: step.label, value: formatMoney(Math.abs(step.cents)), op: step.adds ? ('plus' as const) : ('minus' as const) })),
                    { label: 'Company profit', value: money(detail.companyProfitCents, hidden), op: 'total' },
                    { label: 'Company margin', value: percent(detail.companyMarginBp), op: 'note' },
                    ...(detail.bridge.hasCompanyCosts && detail.bridge.companyCostCents !== null && detail.bridge.overheadAbsorbedCents !== null
                      ? [
                          { label: 'Company costs typed in', value: formatMoney(detail.bridge.companyCostCents), op: 'note' as const },
                          { label: 'Overhead your hourly rates covered', value: formatMoney(detail.bridge.overheadAbsorbedCents), op: 'note' as const },
                        ]
                      : []),
                  ]}
                  align="end"
                />
              ) : null
            }
          />
        </dl>
      </div>
    </section>
  );
}

/** One labeled number of the month header. */
function Figure({ label, value, sub, how, strong, tone, testId }: { readonly label: string; readonly value: string; readonly sub?: ReactNode; readonly how?: ReactNode; readonly strong?: boolean; readonly tone?: 'bad'; readonly testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex h-6 items-center gap-1 text-xs text-fg-muted">
        {label}
        {how}
      </dt>
      <dd className={cn('mt-0.5 font-semibold tabular-nums', strong ? 'text-xl tracking-tight' : 'text-lg', tone === 'bad' ? 'text-danger-text' : 'text-fg')} data-testid={testId}>
        {value}
      </dd>
      {sub ? <dd className="mt-0.5 text-xs text-fg-muted">{sub}</dd> : null}
    </div>
  );
}

function Checklist({ detail, closed }: { readonly detail: CloseDetailDTO; readonly closed: boolean }) {
  const done = detail.items.filter((item) => item.state === 'ok').length;
  return (
    <section aria-labelledby="close-checklist" className="rounded-xl border border-border-subtle bg-panel shadow-xs">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <h3 id="close-checklist" className="text-base font-semibold text-fg">
          Checklist
        </h3>
        <span className="text-sm text-fg-secondary tabular-nums" data-testid="close-progress">
          {done} of {detail.items.length} done
        </span>
      </header>
      <ul className="divide-y divide-border-subtle" data-testid="close-items">
        {detail.items.map((item) => (
          <ChecklistItem key={item.key} item={item} closed={closed} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistItem({ item, closed }: { readonly item: CloseItemDTO; readonly closed: boolean }) {
  const Icon = ITEM_ICON[item.state];
  const samePage = item.href?.includes('#company-costs');
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid={`close-item-${item.key}`} data-state={item.state}>
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', ITEM_TONE[item.state])} />
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-sm font-medium text-fg">
          {item.title} <span className="sr-only">({ITEM_WORD[item.state]})</span>
        </p>
        <p className="mt-0.5 text-sm text-fg-secondary">
          {item.detail}
          {item.amountCents !== null && item.amountCents !== 0 ? <span className="tabular-nums"> {item.key === 'payroll' ? `The payroll gap is ${formatMoney(Math.abs(item.amountCents))}.` : `They add up to ${formatMoney(item.amountCents)}.`}</span> : null}
        </p>
      </div>
      {item.state !== 'ok' ? (
        <Badge tone={item.state === 'fix' ? 'danger' : 'warning'} className="mt-0.5">
          {ITEM_WORD[item.state]}
        </Badge>
      ) : null}
      {item.href && item.hrefLabel && !(closed && item.state !== 'ok' && !samePage) ? (
        samePage ? (
          <a href="#company-costs" className="mt-0.5 inline-flex h-7 shrink-0 items-center rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
            {item.hrefLabel}
          </a>
        ) : (
          <ButtonLink href={item.href} variant="secondary" size="sm">
            {item.hrefLabel}
          </ButtonLink>
        )
      ) : null}
    </li>
  );
}

function CloseDialog({ month, detail, onCancel, onConfirm }: { readonly month: CloseMonthDTO; readonly detail: CloseDetailDTO; readonly onCancel: () => void; readonly onConfirm: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = detail.items.filter((item) => item.state === 'fix');
  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onCancel() : undefined)}>
      <DialogContent size="md" data-testid="close-dialog">
        <DialogHeader title={`Close ${month.label}?`} description="Closing saves the month's numbers and locks its entries." />
        <DialogBody className="flex flex-col gap-3 text-sm text-fg-secondary">
          <p>
            {detail.totalRows === 0 ? `Nothing is dated in ${month.label}.` : `${formatNumber(detail.totalRows)} ${detail.totalRows === 1 ? 'row' : 'rows'} dated in ${month.label} will be locked.`} Nobody can add, change or delete an entry in it, by hand or by an import, until the owner reopens the month.
          </p>
          {open.length > 0 ? (
            <div className="rounded-lg bg-warning-subtle px-3 py-2.5 text-warning-text" data-testid="close-dialog-warning">
              <p className="font-medium">
                {open.length} {open.length === 1 ? 'step is' : 'steps are'} not done. The saved numbers will carry these gaps:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {open.map((item) => (
                  <li key={item.key}>{item.detail}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-fg">
              <CircleCheck aria-hidden className="size-4 text-success" />
              The checklist is clear.
            </p>
          )}
          {error ? (
            <p role="alert" className="text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Not yet
          </Button>
          <Button
            loading={busy}
            leadingIcon={<Lock aria-hidden />}
            data-testid="close-confirm"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const problem = await onConfirm();
                if (problem) setError(problem);
              } catch {
                setError('Check your connection and try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {open.length > 0 ? 'Close it anyway' : `Close ${month.label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ month, onCancel, onConfirm }: { readonly month: CloseMonthDTO; readonly onCancel: () => void; readonly onConfirm: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Say why the month is being reopened, in a few words.');
    setBusy(true);
    setError(null);
    try {
      const problem = await onConfirm(reason.trim());
      if (problem) setError(problem);
    } catch {
      setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onCancel() : undefined)}>
      <DialogContent size="md" data-testid="reopen-dialog">
        <DialogHeader title={`Reopen ${month.label}?`} description="Entries in the month can change again, so its profit can move. The reason is kept in the history." />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody>
            <Field label="Why are you reopening it" error={error} hint="For example: a late freight bill came in." required>
              {({ inputId, describedBy, invalid }) => (
                <Textarea
                  id={inputId}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  rows={3}
                  maxLength={500}
                  autoFocus
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError(null);
                  }}
                  data-testid="reopen-reason"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
              Keep it closed
            </Button>
            <Button type="submit" loading={busy} leadingIcon={<LockOpen aria-hidden />} data-testid="reopen-confirm">
              Reopen {month.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
