'use client';
/**
 * Overview panels (docs/programs/SPEC.md 5.6): Today's run, Price card, Statement, Pulse, the
 * Details · Linked · Activity panel, All linked work and Updates. Money panels read the summary
 * DTO only; nothing here adds money up on its own except to show parts that the engine already
 * split (and the parts always add back to the engine total).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Briefcase, CalendarPlus, CheckCircle2, ClipboardPen, FileSpreadsheet, FileText, Plus, Receipt, RefreshCcw, TriangleAlert } from 'lucide-react';
import { formatCents, formatMarginBp, formatUnitPrice, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip, buttonVariants } from '@/components/ui';
import { PersonAvatar, StatusIcon } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { useServerAction } from '@/lib/hooks/use-action';
import { useProjectUpdates } from '@/lib/hooks/use-data';
import { useProgramActivity, useProgramBuilds, useProgramLinks, useProgramPulse } from '@/lib/hooks/use-programs';
import { useTaskDrawer } from '@/lib/hooks/use-task-drawer';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { CardVersionDTO, LinkedWorkDTO, ProgramSummaryDTO, PulseParityDTO, RunDTO, TodayDTO, UnitLabel } from '@/lib/program-types';
import { describeActivity } from '@/lib/activity-text';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { postProgramUpdateAction } from '@/server/actions/programs';
import { StatusUpdateComposer, UpdateHistory } from '@/features/projects/status-updates-panel';
import { LinkPulseJobDialog } from '@/features/integrations/link-pulse-job-dialog';
import { LinkedRecordChip } from '@/features/integrations/record-chip';
import { useCurrentProgram } from '../program-context';
import { QtyProgress, RunRing } from '../kit/numbers';
import { useHydrated } from '../kit/use-hydrated';
import { doneOfText, qtyOfText } from '../kit/format';
import { statementFileHref, statementHref } from '../frame/program-menu';
import { useProgramOverlays } from '../overlays/overlay-params';
import { RunMenu } from '../builds/run-menu';
import { AdjustmentDialog } from '../adjustments/adjustment-dialog';
import { CHARGE_GROUP_ORDER, groupLabel, variantColorMap, weekdayDate, type ChargeGroup } from './overview-model';

/* ---------------------------------------------------------------------------------------------- */
/* Today's run                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function RunBlock({ run, unit, builds }: { readonly run: RunDTO; readonly unit: UnitLabel; readonly builds: ReturnType<typeof useProgramBuilds> }) {
  const { statusById, today, variants } = useCurrentProgram();
  const drawer = useTaskDrawer();
  const colors = useMemo(() => variantColorMap(variants), [variants]);
  // Variant order, the same as the Variants tab and the statement; the build key breaks ties.
  const items = useMemo(() => {
    const order = new Map(variants.map((variant, index) => [variant.id, index]));
    return (builds.data?.items ?? [])
      .filter((item) => item.build.runId === run.id)
      .sort((a, b) => (order.get(a.build.variantId ?? '') ?? 999) - (order.get(b.build.variantId ?? '') ?? 999) || a.key.localeCompare(b.key, 'en', { numeric: true }));
  }, [builds.data, run.id, variants]);
  return (
    <div className="flex flex-col" data-testid="today-run">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <RunRing done={run.done} total={run.builds - run.cancelled} size={28} label={doneOfText(run.done, run.builds - run.cancelled)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{run.scheduleId ? run.name : 'Unscheduled'}</p>
          <p className="truncate text-xs text-fg-muted tabular-nums">
            {qtyOfText(run.builtUnits, run.plannedUnits, unit)} · {doneOfText(run.done, run.builds - run.cancelled)}
          </p>
        </div>
        <RunMenu run={run} />
      </div>
      <ul className="flex flex-col border-t border-border-subtle">
        {builds.isLoading
          ? [0, 1, 2].map((index) => (
              <li key={index} className="px-4 py-2">
                <Skeleton height={20} />
              </li>
            ))
          : items.map((item) => {
              const status = statusById.get(item.statusId);
              const over = Number(item.build.builtQty) - Number(item.build.plannedQty);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => drawer.openTask(item.key)}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 px-4 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
                    data-testid="today-build"
                  >
                    <StatusIcon category={item.statusCategory} color={status?.color} label={status?.name} />
                    <span className="flex min-w-0 items-center gap-1.5">
                      {item.build.variantName ? (
                        <span className="inline-flex h-5 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-sunken px-2 text-2xs font-medium text-fg">
                          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: colors.get(item.build.variantId ?? '') ?? 'var(--label-gray)' }} />
                          <span className="min-w-0 truncate">{item.build.variantName}</span>
                        </span>
                      ) : (
                        <span className="truncate text-sm text-fg">{item.title}</span>
                      )}
                      {over > 0 ? <Badge tone="warning">{`${unitLabel(String(over), unit)} over`}</Badge> : null}
                      {item.build.locked && run.date < today ? <Badge tone="neutral">Locked</Badge> : null}
                    </span>
                    <QtyProgress built={item.build.builtQty} planned={item.build.plannedQty} unit={unit} className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto sm:justify-self-end" />
                    <span className="row-start-1 col-start-3 sm:col-start-auto sm:row-start-auto">{item.assigneeId ? <PersonAvatar userId={item.assigneeId} size="xs" /> : <span className="inline-block size-5" />}</span>
                  </button>
                </li>
              );
            })}
      </ul>
    </div>
  );
}

export function TodayRunPanel({ today }: { readonly today: TodayDTO }) {
  const { key, unit, capabilities, program } = useCurrentProgram();
  const overlays = useProgramOverlays();
  // One builds read for the whole day, shared by every run block (not one request per run).
  const builds = useProgramBuilds(key, { from: today.date, to: today.date, limit: 500 }, { enabled: today.runs.length > 0 });
  return (
    <section id="today" className="rounded-xl border border-border-subtle bg-panel shadow-xs" aria-label="Today's run">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h2 className="text-base font-semibold text-fg">Today · {weekdayDate(today.date)}</h2>
        <div className="flex items-center gap-1.5">
          {capabilities.canPlan ? (
            <Button size="sm" variant="ghost" onClick={() => overlays.openPlanner('day', program.calendar.nextWorkDay)}>
              <CalendarPlus aria-hidden />
              Plan tomorrow
            </Button>
          ) : null}
          {capabilities.canLog && today.builds > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => overlays.openLog({ date: today.date })}>
              <ClipboardPen aria-hidden />
              Log output
            </Button>
          ) : null}
        </div>
      </header>
      {today.runs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <p className="text-sm font-medium text-fg">No builds today</p>
          <p className="text-xs text-fg-muted">{today.isWorkDay ? 'Plan builds for today, or let a schedule make them.' : 'Today is not a work day for this program.'}</p>
          {capabilities.canPlan ? (
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => overlays.openPlanner('day', today.date)}>
              Plan builds
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {today.runs.map((run) => (
            <RunBlock key={run.id} run={run} unit={unit} builds={builds} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Price card                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** Compact line texts: "$1.95 per kit", "Size is XL: add $0.25", "$1,500.00 monthly fee". */
export function versionLineTexts(version: CardVersionDTO, unit: UnitLabel, variantName: (id: string) => string | null): string[] {
  const texts: string[] = [];
  for (const line of [...version.lines].sort((a, b) => a.position - b.position)) {
    if (line.kind === 'per_unit' && line.variantId === null) texts.push(`${formatUnitPrice(line.unitPrice)} per ${unit.singular}`);
    else if (line.kind === 'per_unit' && line.ruleId === null && line.variantId) texts.push(`${variantName(line.variantId) ?? 'Variant'}: ${formatUnitPrice(line.unitPrice)}`);
    else if (line.kind === 'per_order') texts.push(`${formatCents(line.amountCents, { cents: true })} per batch`);
    else if (line.kind === 'per_hour') texts.push(`${formatCents(line.rateCents, { cents: true })} an hour`);
    else if (line.kind === 'flat_monthly') texts.push(`${formatCents(line.amountCents, { cents: true })} monthly fee`);
    else if (line.kind === 'monthly_minimum') texts.push(`${formatCents(line.amountCents, { cents: true })} monthly minimum`);
  }
  const fixedAt = texts.findIndex((text) => text.endsWith('monthly fee') || text.endsWith('monthly minimum'));
  const rules = version.rules.map((rule) => rule.text);
  if (fixedAt < 0) return [...texts, ...rules];
  return [...texts.slice(0, fixedAt), ...rules, ...texts.slice(fixedAt)];
}

export function PriceCardPanel() {
  const { program, key, unit, capabilities, moneyHidden, variantById } = useCurrentProgram();
  const router = useRouter();
  const current = program.currentVersion;
  const next = program.nextVersion;
  const lines = current && !moneyHidden ? versionLineTexts(current, unit, (id) => variantById.get(id)?.name ?? null) : [];
  return (
    <Panel
      title="Price card"
      action={current?.number ? <Badge tone="success">{`v${current.number} · since ${shortDate(current.effectiveFrom)}`}</Badge> : null}
    >
      {!current ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-secondary">{next?.number ? `v${next.number} starts ${shortDate(next.effectiveFrom)}. Until then output has no price.` : 'No price card yet. Output is logged, but it earns nothing until a card is in force.'}</p>
        </div>
      ) : moneyHidden ? (
        <p className="text-sm text-fg-muted">Money is hidden for your role.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm" data-testid="price-card-lines">
          {lines.map((text) => (
            <li key={text} className="flex items-center gap-2 text-fg">
              <Receipt aria-hidden className="size-3.5 shrink-0 text-icon" />
              <span className="tabular-nums">{text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {next?.number && current ? <Badge tone="info">{`v${next.number} starts ${shortDate(next.effectiveFrom)}`}</Badge> : null}
        {program.pendingRateChanges ? <Badge tone="warning">{`${program.pendingRateChanges.count} rate ${program.pendingRateChanges.count === 1 ? 'change' : 'changes'} waiting`}</Badge> : null}
        {program.draftsCount > 0 && !program.pendingRateChanges ? <Badge tone="neutral">{program.draftsCount === 1 ? '1 draft' : `${program.draftsCount} drafts`}</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
        <Button size="sm" variant="secondary" onClick={() => router.push(routes.programTab(key, 'price-card'))}>
          Open price card
        </Button>
        {capabilities.canPropose ? (
          <Button size="sm" variant="ghost" onClick={() => router.push(`${routes.programTab(key, 'price-card')}?new=1`)}>
            <Plus aria-hidden />
            New version
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Statement                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export function StatementPanel({ summary }: { readonly summary: ProgramSummaryDTO }) {
  const { key, unit, capabilities, today } = useCurrentProgram();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const r = summary.result;
  const amounts: Partial<Record<ChargeGroup, string>> = {
    per_unit: r.work?.perUnitCents,
    per_order: r.work?.perOrderCents,
    per_hour: r.work?.perHourCents,
    flat_monthly: r.fixed?.monthlyFeeCents,
    setup: r.fixed?.setupCents,
    adjustment: r.adjustments?.totalCents,
    minimum_top_up: r.minimum?.topUpCents,
  };
  const groups = CHARGE_GROUP_ORDER.filter((group) => amounts[group] && BigInt(amounts[group] as string) !== BigInt(0));
  const canAdjust = capabilities.canPropose || capabilities.canManage;
  return (
    <Panel
      title="Statement"
      action={
        <span className="flex items-center gap-0.5">
          <Tooltip content="Download CSV">
            <a href={statementFileHref(key, summary.month, 'csv')} download className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label="Download the statement as CSV">
              <FileSpreadsheet aria-hidden />
            </a>
          </Tooltip>
          <Tooltip content="Download PDF">
            <a href={statementFileHref(key, summary.month, 'pdf')} download className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label="Download the statement as PDF">
              <FileText aria-hidden />
            </a>
          </Tooltip>
        </span>
      }
    >
      <dl className="flex flex-col gap-1.5 text-sm" data-testid="statement-panel">
        {groups.length === 0 ? <p className="text-sm text-fg-muted">No charges yet this month.</p> : null}
        {groups.map((group) => (
          <div key={group} className="flex items-center justify-between gap-3">
            <dt className="text-fg-secondary">{groupLabel(group, unit)}</dt>
            <dd className="text-fg tabular-nums">{formatCents(amounts[group], { cents: true })}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
          <dt className="font-semibold text-fg">Total so far</dt>
          <dd className="font-semibold text-fg tabular-nums" data-testid="statement-panel-total">
            {formatCents(r.totalCents, { cents: true })}
          </dd>
        </div>
        {r.minimum && r.minimum.status === 'pending' ? <p className="text-xs text-fg-muted">The minimum top up is added after the month ends.</p> : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
        <Button size="sm" variant="secondary" onClick={() => router.push(statementHref(key, summary.month), { scroll: false })}>
          View statement
        </Button>
        {canAdjust ? (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add adjustment
          </Button>
        ) : null}
      </div>
      {adding ? <AdjustmentDialog open={adding} onOpenChange={setAdding} defaultDate={today} /> : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Pulse                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

function minutesAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  // Floor, the same rounding as the Pulse job page ("Synced 4 hours ago" at 4 h 42 min).
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function PulsePanel({ parity }: { readonly parity: PulseParityDTO }) {
  const { key, program, capabilities, moneyHidden } = useCurrentProgram();
  const queryClient = useQueryClient();
  const pulse = useProgramPulse(key);
  const hydrated = useHydrated();
  const [linking, setLinking] = useState(false);
  const job = pulse.data?.job ?? null;
  // This month's revenue is what Pulse stamped for the program (it matches Projects to the cent).
  // Cost, profit and margin are the job's own totals to date, read from the same Pulse numbers the
  // job page shows, so the two apps never show two different margins for one job.
  const revenue = pulse.data?.stamped?.totalCents ? BigInt(pulse.data.stamped.totalCents) : null;
  const totals = pulse.data?.jobTotals ?? null;
  if (!parity.job && parity.state === 'no_job') {
    return (
      <Panel title="Pulse">
        <p className="text-sm text-fg-secondary">Link a Pulse job to see labor, cost and margin.</p>
        {capabilities.canManage ? (
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setLinking(true)}>
            <Briefcase aria-hidden />
            Link job
          </Button>
        ) : null}
        {linking ? (
          <LinkPulseJobDialog
            open={linking}
            onOpenChange={setLinking}
            target={{ kind: 'program', programKey: key, programId: program.id }}
            onLinked={() => {
              void queryClient.invalidateQueries({ queryKey: qk.program(key) });
            }}
          />
        ) : null}
      </Panel>
    );
  }
  const url = parity.job?.url ?? null;
  return (
    <Panel
      title="Pulse"
      action={
        url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Open in Pulse
            <ArrowUpRight aria-hidden />
          </a>
        ) : null
      }
      bodyClassName="p-0"
    >
      {parity.job ? (
        <div className="flex flex-col gap-2 px-4 py-3" data-testid="pulse-job-row">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.04em] text-fg-secondary tabular-nums">{parity.job.number}</span>
            <span className="min-w-0 truncate text-sm font-medium text-fg">{parity.job.name}</span>
            {job ? <Badge tone={job.status === 'active' ? 'success' : 'neutral'}>{job.status === 'active' ? 'Active' : job.status.replace(/_/g, ' ')}</Badge> : null}
          </div>
          {moneyHidden ? null : pulse.isLoading ? (
            <Skeleton height={36} />
          ) : (
            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div className="flex min-w-0 flex-col">
                  <dt className="text-fg-muted">Revenue this month</dt>
                  <dd className="truncate text-sm font-semibold text-fg tabular-nums">{formatCents(revenue, { cents: true, empty: 'None yet' })}</dd>
                </div>
              </dl>
              {totals ? (
                <>
                  <p className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Job to date, as Pulse shows it</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4" data-testid="pulse-job-totals">
                    {(
                      [
                        ['Revenue earned', formatCents(totals.revenueCents, { cents: true })],
                        ['Cost so far', formatCents(totals.costCents, { cents: true })],
                        ['Profit', formatCents(totals.profitCents, { cents: true })],
                        ['Margin', formatMarginBp(totals.marginBp, { empty: 'No revenue' })],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="flex min-w-0 flex-col">
                        <dt className="text-fg-muted">{label}</dt>
                        <dd className="truncate text-sm font-semibold text-fg tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="text-xs text-fg-muted">Cost, profit and margin show on the Pulse job once it has numbers.</p>
              )}
            </div>
          )}
        </div>
      ) : null}
      {moneyHidden ? null : (
        <div className="flex flex-col gap-1 border-t border-border-subtle px-4 py-2.5">
          {parity.state === 'matches' ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success-text" data-testid="pulse-parity">
              <CheckCircle2 aria-hidden className="size-4" />
              Matches Pulse to the cent
            </p>
          ) : capabilities.seesSync ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-warning-text" data-testid="pulse-parity">
              <TriangleAlert aria-hidden className="size-4" />
              {parity.deltaCents && parity.deltaCents !== '0' ? `Pulse is ${formatCents(parity.deltaCents.replace('-', ''), { cents: true })} off.` : 'Pulse is catching up.'}
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted" data-testid="pulse-parity">
              <RefreshCcw aria-hidden className="size-4" />
              Pulse is catching up
            </p>
          )}
          {capabilities.seesSync && parity.lastSyncAt && hydrated ? <p className="text-xs text-fg-muted">Last sync {minutesAgo(parity.lastSyncAt)}</p> : null}
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* All linked work                                                                                */
/* ---------------------------------------------------------------------------------------------- */

export function LinkedWorkPanel({ linkedWork }: { readonly linkedWork: LinkedWorkDTO }) {
  const { key } = useCurrentProgram();
  return (
    <Panel title="All linked work" bodyClassName="p-0">
      <dl className="flex flex-col text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <dt className="font-medium text-fg">Program {key}</dt>
          <dd className="font-medium text-fg tabular-nums">{formatCents(linkedWork.programCents, { cents: true })}</dd>
        </div>
        <div className="flex flex-col gap-1 border-t border-border-subtle px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-fg">Other linked jobs</dt>
            <dd className="font-medium text-fg tabular-nums">{formatCents(linkedWork.relatedCents, { cents: true })}</dd>
          </div>
          <ul className="flex flex-col gap-1">
            {linkedWork.relatedJobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 text-xs">
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-fg-secondary hover:text-fg hover:underline">
                  {job.number} {job.name} · related
                </a>
                <span className="text-fg-secondary tabular-nums">{formatCents(job.revenueCents, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border-default bg-sunken/60 px-4 py-2.5">
          <dt className="font-semibold text-fg">Total</dt>
          <dd className="font-semibold text-fg tabular-nums">{formatCents(linkedWork.totalCents, { cents: true })}</dd>
        </div>
      </dl>
      <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">The program&apos;s own Pulse job is part of the program, so it is not added again.</p>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Updates                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function UpdatesPanel({ draft }: { readonly draft: string }) {
  const { key, program, capabilities } = useCurrentProgram();
  const updates = useProjectUpdates(key);
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const post = useServerAction(postProgramUpdateAction, {
    successMessage: 'Update posted. Members will see it in their inbox.',
    errorTitle: "Couldn't post the update",
    onSuccess: async () => {
      setComposing(false);
      await queryClient.invalidateQueries({ queryKey: qk.projectUpdates(key) });
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
    },
  });
  return (
    <Panel
      title="Updates"
      action={
        capabilities.canEdit && !composing ? (
          <Button size="sm" variant="secondary" onClick={() => setComposing(true)} data-testid="overview-post-update">
            Post an update
          </Button>
        ) : null
      }
    >
      {composing ? (
        <div className="mb-4">
          <StatusUpdateComposer
            autoFocus
            initialHealth={program.health ?? 'on_track'}
            initialNote={draft}
            pending={post.pending}
            onCancel={() => setComposing(false)}
            onSubmit={async ({ health, note }) => (note ? Boolean(await post.run({ key, health, body: note })) : false)}
          />
        </div>
      ) : null}
      <UpdateHistory updates={updates.data ?? []} loading={updates.isLoading} emptyText="No updates yet. Post one to tell members how the program is going." />
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Details · Linked · Activity                                                                    */
/* ---------------------------------------------------------------------------------------------- */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function workDaysText(days: readonly number[]): string {
  const sorted = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day));
  if (sorted.length === 5 && sorted.every((day) => day >= 1 && day <= 5)) return 'Mon to Fri';
  if (sorted.length === 7) return 'Every day';
  return sorted.map((day) => WEEKDAY_NAMES[day]).join(', ');
}

export function DetailsTabsPanel() {
  const { key, program, unit, variantById, statusById } = useCurrentProgram();
  const people = usePeopleMap();
  const links = useProgramLinks(key);
  const activity = useProgramActivity(key, 'all');
  const owner = program.owner?.name ?? 'No owner';
  const calendarSource = program.settings.workingDays ? 'own work days' : 'workspace calendar';
  const details: [string, React.ReactNode][] = [
    ['Owner', owner],
    ['Customer', program.customer?.name ?? 'None'],
    ['Unit', `${unit.singular} / ${unit.plural}`],
    ['Time zone', program.calendar.timezone],
    ['Work days', `${workDaysText(program.calendar.workingDays)} · ${calendarSource}`],
    ['Dates', program.startDate ? `${shortDate(program.startDate)} to ${program.endDate ? shortDate(program.endDate) : 'no end date'}` : 'No start date'],
    ['Schedules', program.schedulesActive === 1 ? '1 active' : `${program.schedulesActive} active`],
    ['Members', String(program.members.length)],
  ];
  return (
    <section className="rounded-xl border border-border-subtle bg-panel shadow-xs">
      <Tabs defaultValue="details">
        <div className="border-b border-border-subtle px-2">
          <TabsList variant="underline" aria-label="Program details">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="linked">Linked</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="details" className="p-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="min-w-0 truncate text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="linked" className="p-4">
          {links.isLoading ? (
            <Skeleton height={64} />
          ) : (links.data ?? []).length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing linked yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {(links.data ?? []).slice(0, 5).map((link) => (
                <li key={link.linkId} className="max-w-full">
                  <LinkedRecordChip record={link} size="sm" />
                </li>
              ))}
            </ul>
          )}
          <Link href={routes.programTab(key, 'linked')} className="mt-3 inline-flex text-xs font-medium text-fg-secondary hover:text-fg hover:underline">
            See all{links.data && links.data.length > 5 ? ` ${links.data.length}` : ''}
          </Link>
        </TabsContent>
        <TabsContent value="activity" className="p-4">
          {activity.isLoading ? (
            <Skeleton height={96} />
          ) : (
            <ul className="flex flex-col gap-2">
              {(activity.data?.items ?? []).slice(0, 8).map((row) => (
                <li key={row.id} className="flex items-start gap-2 text-sm">
                  <PersonAvatar userId={row.actorId} size="xs" />
                  <span className="min-w-0 flex-1 text-fg-secondary">
                    <span className="font-medium text-fg">{row.actorKind === 'automation' ? 'Automation' : row.actorId ? (people.get(row.actorId)?.name ?? 'Someone') : 'KitStak'}</span>{' '}
                    {describeActivity(row, { personName: (id) => people.get(id)?.name, statusName: (id) => statusById.get(id)?.name, variantName: (id) => variantById.get(id)?.name })}
                  </span>
                </li>
              ))}
              {(activity.data?.items ?? []).length === 0 ? <li className="text-sm text-fg-muted">No activity yet.</li> : null}
            </ul>
          )}
          <Link href={routes.programTab(key, 'activity')} className="mt-3 inline-flex text-xs font-medium text-fg-secondary hover:text-fg hover:underline">
            See all
          </Link>
        </TabsContent>
      </Tabs>
    </section>
  );
}


