'use client';
/**
 * Item panel "Profit" tab: KitStak Pulse numbers for this record.
 *  - On a deal: the Pulse jobs made from it, each with health, how far along it is, revenue,
 *    cost, profit and margin, and a link that creates a Pulse job from the deal, prefilled.
 *  - On an account: the client's profit for the last 90 days and 12 months, the margin by
 *    month, and its open jobs.
 * Numbers come from the CRM server (which reads Pulse's own rollups through
 * @kitstak/pulse-bridge), never from a browser call to Pulse. Nothing is worked out here.
 * People who may not see money in Pulse get the same tab with units, hours and health only.
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, ClipboardPen, EyeOff, Plus } from 'lucide-react';
import { formatCents, formatMarginBp, formatQuantity, statusTone, type PulseTone } from '@kitstak/pulse-bridge/format';
import type { PulseMonthPoint, PulsePeriodProfit } from '@kitstak/pulse-bridge/types';
import { displayText } from '@kitstak/ui/text';
import { Button, EmptyState, ProgressBar, Skeleton, StatusPill, buttonVariants, cn } from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import type { ItemPulseClient, ItemPulseDto, ItemPulseJob } from '@/server/services/pulse-bridge';
import { useItemPulse } from './api';
import { PulseMark } from './pulse-mark';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

const TONE_COLOR: Readonly<Record<PulseTone, 'green' | 'yellow' | 'orange' | 'red' | 'gray'>> = {
  good: 'green',
  watch: 'yellow',
  warn: 'orange',
  bad: 'red',
  quiet: 'gray',
};

/** A link that looks like a button: these all leave the CRM for Pulse in a new tab. */
function LinkButton({
  href,
  children,
  icon,
  variant = 'secondary',
  testId,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly testId?: string;
}) {
  return (
    <a href={href} {...EXTERNAL} className={buttonVariants({ variant, size: 'sm' })} data-testid={testId}>
      {icon}
      {children}
      <span className="sr-only"> (opens KitStak Pulse in a new tab)</span>
    </a>
  );
}

function Stat({ label, value, hint, tone, raised }: { readonly label: string; readonly value: string; readonly hint?: string; readonly tone?: 'danger' | 'success'; readonly raised?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-md px-3 py-2', raised ? 'border border-border-subtle bg-panel' : 'bg-sunken')}>
      <dt className="order-2 truncate text-xs text-fg-muted">{label}</dt>
      <dd className={cn('order-1 truncate text-base font-semibold tabular-nums', tone === 'danger' ? 'text-danger-text' : tone === 'success' ? 'text-success-text' : 'text-fg')}>
        {value}
      </dd>
      {hint ? <dd className="order-3 truncate text-2xs text-fg-muted">{hint}</dd> : null}
    </div>
  );
}

function percentDone(job: ItemPulseJob): number | null {
  return job.pctCompleteBp === null ? null : Math.round(job.pctCompleteBp / 100);
}

function JobCard({ job, moneyHidden, canLog, dealValueCents }: { readonly job: ItemPulseJob; readonly moneyHidden: boolean; readonly canLog: boolean; readonly dealValueCents: number | null }) {
  const done = percentDone(job);
  const tone = statusTone(job.risk);
  const quoteDiffers = !moneyHidden && dealValueCents !== null && job.quoteRevenueCents !== null && job.quoteRevenueCents !== dealValueCents;
  return (
    <li className="rounded-lg border border-border-subtle bg-panel p-3" data-testid="crm-pulse-job">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.04em] text-fg-secondary tabular-nums">{job.number}</span>
        <a
          href={job.url}
          {...EXTERNAL}
          className="min-w-0 flex-1 basis-40 truncate text-base font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          title={displayText(job.name)}
        >
          {displayText(job.name)}
        </a>
        <StatusPill label={job.riskLabel ?? job.statusLabel} color={TONE_COLOR[tone]} />
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {job.statusLabel}
        {job.clientName ? ` · ${displayText(job.clientName)}` : ''}
        {job.dueDate ? ` · due ${job.dueDate}` : ''}
      </p>
      <div className="mt-3">
        {done === null ? null : (
          <ProgressBar
            value={done}
            size="sm"
            tone={tone === 'bad' ? 'danger' : tone === 'warn' ? 'warning' : 'primary'}
            label={`${job.number} is ${done} percent done`}
          />
        )}
        <p className="mt-1 text-xs text-fg-secondary tabular-nums">
          {formatQuantity(job.unitsGood)}{Number(job.plannedUnits) > 0 ? ` of ${formatQuantity(job.plannedUnits)}` : ''} {job.unitLabel} done
          {done !== null ? ` (${done}%)` : ''} · {formatQuantity(job.hours)} hours logged
        </p>
      </div>
      {moneyHidden ? null : (
        <dl className="mt-3 grid grid-cols-2 gap-2 @min-[520px]:grid-cols-4">
          <Stat label="Revenue so far" value={formatCents(job.revenueCents)} hint={job.quoteRevenueCents !== null ? `Quote ${formatCents(job.quoteRevenueCents)}` : 'No quote in Pulse'} />
          <Stat label="Cost so far" value={formatCents(job.costCents)} />
          <Stat label="Profit so far" value={formatCents(job.profitCents)} tone={(job.profitCents ?? 0) < 0 ? 'danger' : undefined} />
          <Stat
            label="Margin"
            value={formatMarginBp(job.marginBp, { empty: 'None yet' })}
            hint={job.targetMarginBp !== null ? `Target ${formatMarginBp(job.targetMarginBp)}` : undefined}
            tone={job.marginBp !== null && job.marginBp < 0 ? 'danger' : undefined}
          />
        </dl>
      )}
      {!moneyHidden && job.projectedProfitCents !== null && job.status !== 'completed' ? (
        <p className="mt-2 text-xs text-fg-secondary">
          {Number(job.unitsGood) > 0 ? 'At this pace the job finishes' : 'By the plan the job finishes'} with a profit of{' '}
          <span className={cn('font-semibold tabular-nums', job.projectedProfitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatCents(job.projectedProfitCents)}</span>
          {job.projectedMarginBp !== null ? ` (${formatMarginBp(job.projectedMarginBp)} margin)` : ''}.
        </p>
      ) : null}
      {quoteDiffers ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning-subtle px-2.5 py-1.5 text-xs text-warning-text" data-testid="crm-pulse-quote-check">
          This deal is {formatCents(dealValueCents)} here. The quote in Pulse is {formatCents(job.quoteRevenueCents)}. Open the job to update the quote or keep it.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <LinkButton href={job.url} icon={<ArrowUpRight aria-hidden />} testId="crm-pulse-open-job">
          Open {job.number}
        </LinkButton>
        {canLog && job.status !== 'completed' && job.status !== 'cancelled' ? (
          <LinkButton href={job.logUrl} variant="ghost" icon={<ClipboardPen aria-hidden />} testId="crm-pulse-log">
            Log work
          </LinkButton>
        ) : null}
      </div>
    </li>
  );
}

function MoneyHiddenNote() {
  return (
    <p className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-xs text-fg-secondary" data-testid="crm-pulse-money-hidden">
      <EyeOff aria-hidden className="size-3.5 shrink-0" />
      Your Pulse role does not include money, so revenue, cost and profit are hidden here.
    </p>
  );
}

function PeriodRow({ title, period }: { readonly title: string; readonly period: PulsePeriodProfit }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-fg-secondary">{title}</h4>
      <dl className="mt-1.5 grid grid-cols-2 gap-2 @min-[520px]:grid-cols-4">
        <Stat raised label="Revenue" value={formatCents(period.revenueCents)} />
        <Stat raised label="Cost" value={formatCents(period.costCents)} />
        <Stat raised label="Profit" value={formatCents(period.profitCents)} tone={(period.profitCents ?? 0) < 0 ? 'danger' : undefined} />
        <Stat raised label="Margin" value={formatMarginBp(period.marginBp, { empty: 'None yet' })} tone={period.marginBp !== null && period.marginBp < 0 ? 'danger' : undefined} />
      </dl>
    </div>
  );
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const MONTH_LONG = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Margin by month as plain bars. The bar height only places a stored margin on the page. */
function MarginTrend({ trend, targetBp }: { readonly trend: readonly PulseMonthPoint[]; readonly targetBp: number | null }) {
  const withData = trend.filter((point) => point.marginBp !== null);
  if (withData.length < 2) return null;
  const top = Math.max(1000, ...withData.map((point) => Math.abs(point.marginBp ?? 0)), targetBp ?? 0);
  return (
    <figure className="rounded-lg border border-border-subtle bg-panel p-3" data-testid="crm-pulse-trend">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-fg-secondary">Margin by month</span>
        {targetBp !== null ? <span className="text-2xs text-fg-muted">Target {formatMarginBp(targetBp)}</span> : null}
      </figcaption>
      <ol className="mt-3 flex h-24 items-end gap-1" aria-label="Margin by month, oldest first">
        {trend.map((point) => {
          const date = new Date(`${point.month}T00:00:00Z`);
          const bp = point.marginBp;
          const height = bp === null ? 2 : Math.max(4, Math.round((Math.abs(bp) / top) * 100));
          const label = `${MONTH_LONG.format(date)}: ${bp === null ? 'no revenue' : `${formatMarginBp(bp)} margin`}`;
          return (
            <li key={point.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={label}>
              <span className="sr-only">{label}</span>
              <span
                aria-hidden
                className={cn('w-full max-w-7 rounded-sm', bp === null ? 'bg-border-subtle' : bp < 0 ? 'bg-danger' : targetBp !== null && bp < targetBp ? 'bg-warning-accent' : 'bg-success')}
                style={{ height: `${height}%` }}
              />
              <span aria-hidden className="text-2xs text-fg-muted">
                {MONTH.format(date).slice(0, 1)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-2xs text-fg-muted">Green is at or above target, amber is below it, red is a loss.</p>
    </figure>
  );
}

/** Where the numbers come from, in plain words. The full working is one click away in Pulse. */
function HowWeGotThis() {
  return (
    <details className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-xs text-fg-secondary" data-testid="crm-pulse-how">
      <summary className="cursor-pointer font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">How we got these numbers</summary>
      <p className="mt-2">
        Revenue is what the logged units and services earn at the job&apos;s price. Cost is labor (hours times your real cost of an hour), materials, other costs and the job&apos;s share of time not
        on a job. Profit is revenue minus cost. Margin is profit as a share of revenue.
      </p>
      <p className="mt-1.5">These are the same numbers you see in KitStak Pulse, read at the moment this tab loaded. Open a job in Pulse to see every entry behind them.</p>
    </details>
  );
}

function SectionTitle({ children, count }: { readonly children: string; readonly count?: number }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
      {children}
      {count !== undefined ? <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">{count}</span> : null}
    </h3>
  );
}

function TabSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading profit from KitStak Pulse" className="flex flex-col gap-3">
      <Skeleton height={36} rounded="lg" />
      <Skeleton height={168} rounded="lg" />
      <Skeleton height={64} rounded="lg" />
    </div>
  );
}

function Header({ data, title }: { readonly data: ItemPulseDto; readonly title: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <PulseMark size={18} />
        <h2 className="truncate text-base font-semibold text-fg">{title}</h2>
      </div>
      <div className="flex items-center gap-1.5">
        {data.createJobUrl && (data.kind === 'account' || data.jobs.length > 0) ? (
          <LinkButton href={data.createJobUrl} icon={<Plus aria-hidden />} testId="crm-pulse-create-job-header">
            {data.kind === 'deal' ? 'Another job' : 'New job'}
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
}

function DealView({ data, recordName }: { readonly data: ItemPulseDto; readonly recordName: string }) {
  if (data.jobs.length === 0) {
    return (
      <EmptyState
        size="sm"
        visual={<PulseMark size={44} />}
        title="No Pulse job for this deal yet"
        description={
          data.createJobUrl
            ? `A Pulse job tracks what ${displayText(recordName)} really earns: units made, hours worked and cost, day by day. Creating it from here fills in the client, the name and the deal value for you.`
            : 'A Pulse job tracks what this deal really earns. Your Pulse role cannot add jobs, so ask a manager to create one from this deal.'
        }
        actions={
          data.createJobUrl ? (
            <LinkButton href={data.createJobUrl} variant="primary" icon={<Plus aria-hidden />} testId="crm-pulse-create-job">
              Create Pulse job from this deal
            </LinkButton>
          ) : (
            <LinkButton href={data.pulseUrl} icon={<ArrowUpRight aria-hidden />}>
              Open KitStak Pulse
            </LinkButton>
          )
        }
      />
    );
  }
  const totals = data.totals;
  const dealValue = data.deal?.valueCents ?? null;
  const single = data.jobs.length === 1;
  // With several jobs the deal is split across them, so the quotes are checked as one sum.
  // Adding stored whole cents is a count, not profit math.
  const quoted = data.jobs.filter((job) => job.quoteRevenueCents !== null);
  const quoteSum = quoted.reduce((sum, job) => sum + (job.quoteRevenueCents ?? 0), 0);
  const quotesDiffer = !data.moneyHidden && !single && dealValue !== null && quoted.length === data.jobs.length && quoteSum !== dealValue;
  return (
    <div className="flex flex-col gap-4">
      <Header data={data} title="Job profit" />
      {data.moneyHidden ? <MoneyHiddenNote /> : null}
      {!data.moneyHidden && totals && data.jobs.length > 1 ? (
        <dl className="grid grid-cols-2 gap-2 @min-[520px]:grid-cols-4" data-testid="crm-pulse-totals">
          <Stat raised label={`Revenue, ${totals.jobs} jobs`} value={formatCents(totals.revenueCents)} />
          <Stat raised label="Cost" value={formatCents(totals.costCents)} />
          <Stat raised label="Profit" value={formatCents(totals.profitCents)} tone={(totals.profitCents ?? 0) < 0 ? 'danger' : undefined} />
          <Stat raised label="Margin" value={formatMarginBp(totals.marginBp, { empty: 'None yet' })} tone={totals.marginBp !== null && totals.marginBp < 0 ? 'danger' : undefined} />
        </dl>
      ) : null}
      {quotesDiffer ? (
        <p className="rounded-md border border-warning/40 bg-warning-subtle px-2.5 py-1.5 text-xs text-warning-text" data-testid="crm-pulse-quote-check">
          This deal is {formatCents(dealValue)} here. The {data.jobs.length} Pulse quotes add up to {formatCents(quoteSum)}. Open a job to update its quote, or keep them.
        </p>
      ) : null}
      <section aria-label="Pulse jobs made from this deal" className="flex flex-col gap-2">
        <SectionTitle count={data.jobs.length}>{data.jobs.length === 1 ? 'Job from this deal' : 'Jobs from this deal'}</SectionTitle>
        <ul className="flex flex-col gap-2">
          {data.jobs.map((job) => (
            <JobCard key={job.id} job={job} moneyHidden={data.moneyHidden} canLog={data.canLog} dealValueCents={single ? dealValue : null} />
          ))}
        </ul>
      </section>
      <HowWeGotThis />
    </div>
  );
}

function AccountView({ data, client, recordName }: { readonly data: ItemPulseDto; readonly client: ItemPulseClient | null; readonly recordName: string }) {
  if (!client) {
    return (
      <EmptyState
        size="sm"
        visual={<PulseMark size={44} />}
        title="Pulse has no jobs for this account yet"
        description={
          data.createJobUrl
            ? `Add the first job for ${displayText(recordName)} and this tab shows what the account earns you after labor, materials and shared costs.`
            : 'Once a manager adds a Pulse job for this account, its profit shows here.'
        }
        actions={
          data.createJobUrl ? (
            <LinkButton href={data.createJobUrl} variant="primary" icon={<Plus aria-hidden />} testId="crm-pulse-create-job">
              Create a Pulse job for this account
            </LinkButton>
          ) : (
            <LinkButton href={data.pulseUrl} icon={<ArrowUpRight aria-hidden />}>
              Open KitStak Pulse
            </LinkButton>
          )
        }
      />
    );
  }
  const risky = client.atRisk + client.losing;
  return (
    <div className="flex flex-col gap-4">
      <Header data={data} title="Client profit" />
      {data.moneyHidden ? (
        <MoneyHiddenNote />
      ) : (
        <>
          <PeriodRow title="Last 90 days" period={client.recent} />
          {client.year ? <PeriodRow title="Last 12 months" period={client.year} /> : null}
          <MarginTrend trend={client.trend} targetBp={client.targetMarginBp} />
        </>
      )}
      <section aria-label="Open Pulse jobs for this account" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle count={client.openJobs}>Open jobs</SectionTitle>
          <span className={cn('text-xs font-medium', client.losing > 0 ? 'text-danger-text' : risky > 0 ? 'text-warning-text' : 'text-fg-muted')} data-testid="crm-pulse-risk-count">
            {risky === 0 ? 'None at risk' : `${risky} at risk or losing money`}
          </span>
        </div>
        {data.jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-sm text-fg-muted">No open jobs for this client right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.jobs.map((job) => (
              <JobCard key={job.id} job={job} moneyHidden={data.moneyHidden} canLog={data.canLog} dealValueCents={null} />
            ))}
          </ul>
        )}
        {client.openJobs > data.jobs.length ? <p className="text-xs text-fg-muted">Showing the {data.jobs.length} that need the most attention.</p> : null}
      </section>
      <div>
        <LinkButton href={client.url} icon={<ArrowUpRight aria-hidden />} testId="crm-pulse-open-client">
          Open client in Pulse
        </LinkButton>
      </div>
      <HowWeGotThis />
    </div>
  );
}

export interface PulseTabProps {
  readonly itemId: string;
  readonly recordName: string;
}

export function PulseTab({ itemId, recordName }: PulseTabProps) {
  const query = useItemPulse(itemId);
  if (query.isPending) return <TabSkeleton />;
  if (query.isError) {
    return (
      <EmptyState
        size="sm"
        illustration="error"
        title="Could not load profit from Pulse"
        description={errorMessage(query.error)}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const data = query.data;
  if (!data || !data.available) return null;
  return (
    <div className="@container" data-testid="crm-pulse-tab">
      {data.kind === 'deal' ? <DealView data={data} recordName={recordName} /> : <AccountView data={data} client={data.client} recordName={recordName} />}
    </div>
  );
}

/**
 * One line under a deal's name: "Job J-1042 · At risk · 14% margin", or a nudge to create a
 * job on a won deal that has none. Reads the same query as the tab (no extra request).
 */
export function PulseHealthLine({ data, onOpen }: { readonly data: ItemPulseDto; readonly onOpen: () => void }) {
  if (!data.available || data.kind !== 'deal') return null;
  const job = data.jobs[0];
  if (!job && !(data.deal?.won && data.createJobUrl)) return null;
  const tone = statusTone(job?.risk);
  // Several jobs: the line names them all, so it shows their combined margin, the same one the tab totals show.
  const several = data.jobs.length > 1;
  const marginBp = data.moneyHidden || !job ? null : several ? (data.totals?.marginBp ?? null) : job.marginBp;
  const dot: Readonly<Record<PulseTone, string>> = { good: 'var(--success)', watch: 'var(--warning)', warn: 'var(--warning)', bad: 'var(--danger)', quiet: 'var(--border-strong)' };
  const parts = job
    ? [
        data.jobs.length > 1 ? `${data.jobs.length} Pulse jobs` : `Job ${job.number}`,
        job.riskLabel ?? job.statusLabel,
        ...(marginBp === null ? [] : [`${formatMarginBp(marginBp)} margin`]),
      ]
    : ['Won, no Pulse job yet', 'Create one'];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-subtle bg-panel px-2.5 py-1 text-xs font-medium text-fg-secondary hover:border-border-default hover:text-fg"
      data-testid="crm-pulse-health"
    >
      <PulseMark size={12} />
      {job ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: dot[tone] }} /> : null}
      <span className="truncate">{parts.join(' · ')}</span>
    </button>
  );
}
