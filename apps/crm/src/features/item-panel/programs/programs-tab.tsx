'use client';
/**
 * Item panel "Programs" tab (docs/programs/SPEC.md 6.2): the KitStak Projects programs that
 * serve this deal or account. Each card shows the program's status, customer and price card,
 * this month's units, revenue and forecast, today's builds and, on a deal, how the program
 * tracks against the deal ("Deal $386,400 over 12 months · program on track for $390,244").
 * A won deal with no program gets a banner that starts one in Projects, filled in from the deal.
 * The numbers come from the CRM server, which reads the same stored rows Projects and Pulse
 * read, so they match to the cent. People without money access see units only.
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, CalendarCheck2, ChevronDown, EyeOff, PartyPopper, Plus, Repeat2, Sparkles } from 'lucide-react';
import { formatCents, formatPercentBp, formatQty } from '@kitstak/programs-engine/format';
import type { BridgeProgram } from '@kitstak/pm-bridge/programs';
import { displayText } from '@kitstak/ui/text';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  StatusPill,
  buttonVariants,
  cn,
  toLabelColor,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import type { ItemProgramsDto } from '@/server/services/programs-bridge';
import { useItemPrograms } from './api';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

const STATUS_COLOR: Readonly<Record<BridgeProgram['status'], 'green' | 'blue' | 'orange' | 'gray'>> = {
  active: 'green',
  planning: 'blue',
  on_hold: 'orange',
  completed: 'gray',
  archived: 'gray',
};

const METHOD_TEXT: Readonly<Record<BridgeProgram['month']['forecastMethod'], string>> = {
  planned: 'Based on planned builds',
  recent: 'Based on recent days',
};

/** Money the way Projects writes it: whole dollars, with cents only when there are some. */
export function money(cents: string | null): string {
  if (cents === null || !/^-?\d+$/.test(cents)) return 'Hidden';
  return formatCents(cents, { cents: BigInt(cents) % BigInt(100) !== BigInt(0) });
}

/** Whole dollars ("$390,244"): the deal line compares round numbers, like the deal itself. */
function dollars(cents: string | null): string {
  return cents === null || !/^-?\d+$/.test(cents) ? 'Hidden' : formatCents(cents);
}

/**
 * "Deal $386,400 over 12 months · program on track for $390,244". A deal with no term counts
 * 12 months (the engine's rule), and the line says so, so nobody reads it as the contract term.
 */
export function dealLine(deal: NonNullable<BridgeProgram['deal']>): string {
  const months = deal.termMonths ? `${deal.termMonths} ${deal.termMonths === 1 ? 'month' : 'months'}` : '';
  const term = months ? ` over ${months}${deal.termIsDefault ? ` (no term set, so we use ${deal.termMonths})` : ''}` : '';
  const track = deal.onTrackForCents !== null ? ` · program on track for ${dollars(deal.onTrackForCents)}` : '';
  return `Deal ${dollars(deal.valueCents)}${term}${track}`;
}

function programColor(color: string) {
  const c = toLabelColor(color, 'blue');
  return {
    '--lc-bg': `var(--label-${c})`,
    '--lc-subtle': `var(--label-${c}-subtle)`,
    '--lc-text': `var(--label-${c}-text)`,
  } as React.CSSProperties;
}

/** A link that looks like a button: every action here opens KitStak Projects in a new tab. */
function LinkButton({
  href,
  children,
  icon,
  variant = 'secondary',
  size = 'sm',
  testId,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly size?: 'xs' | 'sm';
  readonly testId?: string;
}) {
  return (
    <a href={href} {...EXTERNAL} className={buttonVariants({ variant, size })} data-testid={testId}>
      {icon}
      {children}
      <span className="sr-only"> (opens KitStak Projects in a new tab)</span>
    </a>
  );
}

function Stat({ label, value, hint, children }: { readonly label: string; readonly value: string; readonly hint?: string; readonly children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-sunken px-3 py-2">
      <dt className="order-2 truncate text-xs text-fg-muted">{label}</dt>
      <dd className="order-1 truncate text-base font-semibold text-fg tabular-nums">{value}</dd>
      {hint ? <dd className="order-3 text-2xs text-fg-muted">{hint}</dd> : null}
      {children ? <dd className="order-4 mt-1.5">{children}</dd> : null}
    </div>
  );
}

/**
 * Today's build progress. Normal progress is neutral and a finished day is green: the bar
 * carries no warning color, because the panel does not know whether a build is late.
 */
function TodayBar({ value, label }: { readonly value: number; readonly label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-default)]"
      data-testid="crm-program-today-bar"
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-out',
          clamped === 100 ? 'bg-success' : 'bg-[var(--text-secondary)]',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function ProgramCard({ program }: { readonly program: BridgeProgram }) {
  const { month, today } = program;
  const units = `${formatQty(month.units)} ${month.units === '1.000' ? program.unit.singular : program.unit.plural}`;
  const todayPercent = today.builds === 0 ? 0 : Math.round((today.done / today.builds) * 100);
  const targetText =
    month.targetBp === null ? null : month.targetCents ? `${formatPercentBp(month.targetBp)} of the ${dollars(month.targetCents)} target` : `${formatPercentBp(month.targetBp)} of target`;
  const forecastHint = [METHOD_TEXT[month.forecastMethod], targetText].filter(Boolean).join(' · ');
  const subline = [program.customerName ? displayText(program.customerName) : null, program.cardSummary].filter(Boolean).join(' · ');
  return (
    <li
      className="rounded-lg border border-border-subtle bg-panel p-3 transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-default hover:shadow-xs"
      data-testid="crm-program-card"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--lc-subtle)] text-[var(--lc-text)]"
          style={programColor(program.color)}
        >
          <Repeat2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={program.url}
              {...EXTERNAL}
              className="min-w-0 truncate text-base font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              title={displayText(program.name)}
            >
              {displayText(program.name)}
            </a>
            <span className="shrink-0 text-xs font-medium tracking-[0.01em] text-fg-muted tabular-nums">{program.key}</span>
            <StatusPill label={program.statusLabel} color={STATUS_COLOR[program.status]} />
          </div>
          {subline ? (
            <p className="mt-1 line-clamp-2 text-xs text-fg-muted" title={subline}>
              {subline}
            </p>
          ) : null}
        </div>
        <a
          href={program.url}
          {...EXTERNAL}
          className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'shrink-0')}
          data-testid="crm-program-open"
          aria-label={`Open ${program.name} in KitStak Projects (opens in a new tab)`}
        >
          <ArrowUpRight aria-hidden />
          <span className="hidden @min-[420px]:inline">Open in Projects</span>
        </a>
      </div>
      <dl className={cn('mt-3 grid grid-cols-1 gap-2 @min-[420px]:grid-cols-2', !program.moneyHidden && '@min-[620px]:grid-cols-3')}>
        {program.moneyHidden ? (
          <Stat label="Built this month" value={units} />
        ) : (
          <>
            <Stat label="This month" value={money(month.revenueCents)} hint={`${units} built`} />
            <Stat label="Forecast for the month" value={money(month.forecastCents)} hint={forecastHint} />
          </>
        )}
        <Stat
          label="Today"
          value={today.builds === 0 ? 'No builds' : `${today.done} of ${today.builds} ${today.builds === 1 ? 'build' : 'builds'} done`}
        >
          {today.builds > 0 ? (
            <TodayBar value={todayPercent} label={`${program.key}: ${today.done} of ${today.builds} builds done today`} />
          ) : null}
        </Stat>
      </dl>
      {program.deal ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-secondary tabular-nums" data-testid="crm-program-deal-line">
          <CalendarCheck2 aria-hidden className="mt-px size-3.5 shrink-0 text-fg-muted" />
          <span>{dealLine(program.deal)}</span>
        </p>
      ) : null}
    </li>
  );
}

function TabSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading programs" className="flex flex-col gap-3">
      <Skeleton height={52} rounded="lg" />
      <Skeleton height={176} rounded="lg" />
    </div>
  );
}

function NotLicensed({ url }: { readonly url: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border-subtle bg-panel p-4" data-testid="crm-programs-not-licensed">
      <span className="flex size-9 items-center justify-center rounded-md bg-sunken">
        <Sparkles aria-hidden className="size-4 text-primary" />
      </span>
      <div>
        <p className="text-sm font-semibold text-fg">Add Projects to run programs</p>
        <p className="mt-1 text-xs text-fg-secondary">
          Programs track repeat builds for a customer under one price card, with revenue that matches this deal to the cent.
        </p>
      </div>
      <a href={url} {...EXTERNAL} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
        See plans
        <span className="sr-only"> (opens KitStak Portal in a new tab)</span>
      </a>
    </div>
  );
}

export interface ProgramsTabProps {
  readonly itemId: string;
  readonly term: string;
}

export function ProgramsTab({ itemId, term }: ProgramsTabProps) {
  const query = useItemPrograms(itemId);
  if (query.isPending) return <TabSkeleton />;
  if (query.isError) {
    return (
      <EmptyState
        size="sm"
        illustration="error"
        title="Couldn’t load programs"
        description={errorMessage(query.error)}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const data: ItemProgramsDto | undefined = query.data;
  if (!data) return null;
  if (!data.available) return data.reason === 'not_licensed' && data.addProjectsUrl ? <NotLicensed url={data.addProjectsUrl} /> : null;
  const programs = data.programs;
  const wonWaiting = data.kind === 'deal' && data.deal?.won === true && programs.length === 0 && data.createProgramUrl !== null;
  const running = programs.filter((program) => program.status === 'active').length;
  const builds = programs.reduce((sum, program) => sum + program.today.builds, 0);
  const done = programs.reduce((sum, program) => sum + program.today.done, 0);
  const summary =
    programs.length === 0
      ? `Repeat builds for ${data.kind === 'deal' ? 'this deal’s customer' : 'this customer'}, all billed from one price card`
      : [
          `${programs.length} ${programs.length === 1 ? 'program' : 'programs'}${running > 0 && running < programs.length ? ` · ${running} running` : ''}`,
          builds > 0 ? `${done} of ${builds} builds done today` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="flex flex-col gap-5" data-testid="crm-programs-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-panel px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken">
            <Repeat2 aria-hidden className="size-[18px] text-primary" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-semibold text-fg">
              Programs
              <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">{programs.length}</span>
            </p>
            <p className="line-clamp-2 text-xs text-fg-muted tabular-nums">{summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {data.createProgramUrl && !wonWaiting ? (
            <LinkButton href={data.createProgramUrl} variant="primary" icon={<Plus aria-hidden />} testId="crm-programs-start">
              Start a program
            </LinkButton>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" trailingIcon={<ChevronDown aria-hidden />} data-testid="crm-programs-more">
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                icon={<Repeat2 aria-hidden />}
                description="All programs and this month's numbers"
                onSelect={() => window.open(`${data.projectsUrl}/programs`, '_blank', 'noopener')}
              >
                See all programs
              </DropdownMenuItem>
              <DropdownMenuItem icon={<ArrowUpRight aria-hidden />} onSelect={() => window.open(data.projectsUrl, '_blank', 'noopener')}>
                Open KitStak Projects
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {wonWaiting ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-subtle p-3 @min-[640px]:flex-row @min-[640px]:items-center"
          role="status"
          data-testid="crm-programs-won-banner"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-panel">
            <PartyPopper aria-hidden className="size-4 text-success-text" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">This deal is won. Start a program to track builds and revenue.</p>
            <p className="mt-0.5 text-xs text-fg-secondary">
              {data.deal?.valueCents
                ? `The program starts with this deal’s customer${data.deal.accountName ? `, ${displayText(data.deal.accountName)},` : ''} and its value of ${money(data.deal.valueCents)}.`
                : 'The program starts with this deal’s customer and value.'}
            </p>
          </div>
          <div className="shrink-0">
            <LinkButton href={data.createProgramUrl as string} variant="primary" icon={<Plus aria-hidden />} testId="crm-programs-won-start">
              Start a program
            </LinkButton>
          </div>
        </div>
      ) : null}

      {programs.length === 0 && !wonWaiting ? (
        <EmptyState
          size="sm"
          illustration="board"
          title="No programs yet"
          description="Programs track repeat builds under one price card."
          actions={
            data.createProgramUrl ? (
              <LinkButton href={data.createProgramUrl} icon={<Plus aria-hidden />}>
                Start a program
              </LinkButton>
            ) : undefined
          }
        />
      ) : null}

      {programs.length > 0 ? (
        <section aria-label={`Programs for this ${term.toLowerCase()}`} className="flex flex-col gap-2">
          {data.moneyHidden ? (
            <p className="flex items-center gap-2 rounded-md bg-panel px-3 py-2 text-xs text-fg-secondary" data-testid="crm-programs-money-hidden">
              <EyeOff aria-hidden className="size-3.5 shrink-0" />
              Money is hidden for your role.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
