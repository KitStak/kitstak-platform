'use client';
/**
 * Program card for the directory grid (docs/programs/SPEC.md 5.3): identity, customer and
 * schedule, a KPI strip (This month, Forecast with the target chip, Today with progress), a 30 day
 * units sparkline with the daily target, and a footer with the owner, the Pulse job and the minimum
 * risk chip. The menu is grouped in labeled sections with Danger last.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  Building2,
  CalendarDays,
  ClipboardList,
  Copy,
  ExternalLink,
  Factory,
  FileText,
  Handshake,
  LayoutTemplate,
  Link2,
  MoreHorizontal,
  Pause,
  Play,
  Receipt,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { formatCents, formatQty, fromScaled, unitLabel } from '@kitstak/programs-engine';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  ProgressBar,
  Tooltip,
  cn,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { formatRelative } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { ProgramListItemDTO } from '@/lib/program-types';
import {
  HealthWithBasis,
  ProgramIcon,
  ProgramStatusPill,
  TargetChip,
  floorTodayHref,
  logOutputHref,
  planBuildsHref,
  programHref,
  scaledQty,
  useHydrated,
} from '@/features/programs/kit';
import { minimumRiskText, minimumRiskTitle } from './directory-model';
import type { ProgramOps } from './program-ops';

export interface ProgramMenuAccess {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canCreate: boolean;
}

/** The program menu shared by the card and the table row (5.3 card menu). */
export function ProgramRowMenu({ program, ops, access, onDelete, onTemplate, trigger }: { readonly program: ProgramListItemDTO; readonly ops: ProgramOps; readonly access: ProgramMenuAccess; readonly onDelete: () => void; readonly onTemplate: () => void; readonly trigger?: ReactNode }) {
  const router = useRouter();
  const open = programHref(program.key);
  const log = logOutputHref(program.key, program.today.date);
  const plan = planBuildsHref(program.key);
  const floor = floorTodayHref();
  const priceCard = open ? routes.programTab(program.key, 'price-card') : null;
  const statement = open && !program.moneyHidden ? `${routes.program(program.key)}?statement=${program.month.month}` : null;
  const work = [open, log, plan, floor].some(Boolean);
  const money = Boolean(priceCard || statement);
  const archived = Boolean(program.archivedAt);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger ?? <IconButton label={`More actions for ${program.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" data-testid="program-menu" />}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {work ? (
          <>
            <DropdownMenuLabel>Work</DropdownMenuLabel>
            {open ? <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => router.push(open)}>Open</DropdownMenuItem> : null}
            {log ? <DropdownMenuItem icon={<ClipboardList aria-hidden />} onSelect={() => router.push(log)}>Log output</DropdownMenuItem> : null}
            {plan ? <DropdownMenuItem icon={<CalendarDays aria-hidden />} onSelect={() => router.push(plan)}>Plan builds</DropdownMenuItem> : null}
            {floor ? <DropdownMenuItem icon={<Factory aria-hidden />} onSelect={() => router.push(floor)}>Floor today</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {money ? (
          <>
            <DropdownMenuLabel>Money</DropdownMenuLabel>
            {priceCard ? <DropdownMenuItem icon={<Receipt aria-hidden />} onSelect={() => router.push(priceCard)}>Price card</DropdownMenuItem> : null}
            {statement ? <DropdownMenuItem icon={<FileText aria-hidden />} onSelect={() => router.push(statement)}>This month&apos;s statement</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>Program</DropdownMenuLabel>
        {access.canCreate ? (
          <DropdownMenuItem icon={<Copy aria-hidden />} description="Variants, rates and schedules" onSelect={() => router.push(routes.newProgram({ copy: program.key }))}>
            Copy program
          </DropdownMenuItem>
        ) : null}
        {access.canEdit ? <DropdownMenuItem icon={<LayoutTemplate aria-hidden />} onSelect={onTemplate}>Save as template</DropdownMenuItem> : null}
        <DropdownMenuItem icon={<Star aria-hidden />} onSelect={() => void ops.star(program)}>
          {program.starred ? 'Unstar' : 'Star'}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={() => void ops.copyLink(program)}>Copy link</DropdownMenuItem>
        {access.canEdit && !archived && program.status === 'active' ? (
          <DropdownMenuItem icon={<Pause aria-hidden />} description="Schedules stop making builds" onSelect={() => void ops.setPaused([program], true)}>
            Pause
          </DropdownMenuItem>
        ) : null}
        {access.canEdit && !archived && program.status === 'on_hold' ? (
          <DropdownMenuItem icon={<Play aria-hidden />} description="Schedules start making builds again" onSelect={() => void ops.setPaused([program], false)}>
            Resume
          </DropdownMenuItem>
        ) : null}
        {access.canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Danger</DropdownMenuLabel>
            {archived ? (
              <DropdownMenuItem icon={<ArchiveRestore aria-hidden />} onSelect={() => void ops.restore(program)}>Restore</DropdownMenuItem>
            ) : (
              <DropdownMenuItem icon={<Archive aria-hidden />} description="Hidden from lists. Money and history stay." onSelect={() => void ops.archive([program])}>
                Archive
              </DropdownMenuItem>
            )}
            {access.canDelete ? (
              <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" description="Removes builds, output and the price card" onSelect={onDelete}>
                Delete
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StarToggle({ program, ops }: { readonly program: ProgramListItemDTO; readonly ops: ProgramOps }) {
  return (
    <IconButton
      label={program.starred ? `Unstar ${program.name}` : `Star ${program.name}`}
      icon={<Star aria-hidden className={cn(program.starred && 'fill-warning text-warning')} />}
      size="sm"
      aria-pressed={program.starred}
      onClick={() => void ops.star(program)}
      className={cn(!program.starred && 'opacity-60 group-hover:opacity-100 focus-visible:opacity-100')}
    />
  );
}

export function CustomerChip({ customer, className }: { readonly customer: ProgramListItemDTO['customer']; readonly className?: string }) {
  if (!customer) return <span className={cn('text-fg-muted', className)}>No customer</span>;
  const Icon = customer.kind === 'crm_account' ? Handshake : Building2;
  return (
    <Tooltip content={customer.kind === 'crm_account' ? 'CRM account' : 'Customer'}>
      <span tabIndex={0} className={cn('relative z-[1] inline-flex min-w-0 items-center gap-1 rounded-sm text-fg-secondary outline-none focus-visible:outline-2 focus-visible:outline-focus', className)}>
        <Icon aria-hidden className="size-3.5 shrink-0 text-icon" />
        <span className="truncate">{customer.name}</span>
      </span>
    </Tooltip>
  );
}

/** 30 day units as a line with a soft fill. A dashed line marks the daily target when one is set. */
export function UnitsSparkline({ points, unit, dailyTarget, className }: { readonly points: ProgramListItemDTO['sparkline']; readonly unit: ProgramListItemDTO['unit']; readonly dailyTarget?: string | null; readonly className?: string }) {
  const values = useMemo(() => points.map((point) => scaledQty(point.units)), [points]);
  const target = dailyTarget ? scaledQty(dailyTarget) : BigInt(0);
  const max = values.reduce((best, value) => (value > best ? value : best), target);
  const total = values.reduce((sum, value) => sum + value, BigInt(0));
  const width = 240;
  const height = 36;
  const y = (value: bigint) => (max > BigInt(0) ? height - 3 - (Number((value * BigInt(1000)) / max) / 1000) * (height - 6) : height - 3);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const area = values.length ? `${line} L${((values.length - 1) * step).toFixed(1)},${height} L0,${height} Z` : '';
  const label = total > BigInt(0) ? `Units per day, last 30 days. ${unitLabel(fromScaled(total, 3), unit)} in all.` : 'Units per day, last 30 days. Nothing built yet.';
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('block h-9 w-full', className)} data-testid="units-sparkline">
      <title>{label}</title>
      {area ? <path d={area} fill="var(--chart-1)" opacity={0.12} /> : null}
      {line ? <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
      {target > BigInt(0) ? <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="var(--fg-muted)" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

function Metric({ label, value, aside, children }: { readonly label: string; readonly value: ReactNode; readonly aside?: ReactNode; readonly children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-xs text-fg-muted">{label}</span>
      <span className="truncate text-[20px] leading-6 font-semibold text-fg tabular-nums">{value}</span>
      {aside ? <span className="flex min-h-5 items-center">{aside}</span> : null}
      {children}
    </div>
  );
}

export function ProgramCard({ program, ops, access, onDelete, onTemplate }: { readonly program: ProgramListItemDTO; readonly ops: ProgramOps; readonly access: ProgramMenuAccess; readonly onDelete: () => void; readonly onTemplate: () => void }) {
  const hydrated = useHydrated();
  const href = programHref(program.key);
  const hidden = program.moneyHidden;
  const risk = minimumRiskText(program);
  const todayPercent = program.today.builds > 0 ? Math.round((program.today.done / program.today.builds) * 100) : 0;
  return (
    <article
      data-testid="program-card"
      data-program={program.key}
      className={cn(
        'group relative flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs',
        'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out hover:-translate-y-px hover:border-border-default hover:shadow-sm motion-reduce:hover:translate-y-0',
        program.archivedAt && 'opacity-80',
      )}
    >
      <div className="flex items-start gap-3">
        <ProgramIcon icon={program.icon} color={program.color} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-baseline gap-2">
            {href ? (
              <Link href={href} className="truncate text-md font-semibold text-fg outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-focus" title={program.name}>
                {program.name}
              </Link>
            ) : (
              <span className="truncate text-md font-semibold text-fg" title={program.name}>{program.name}</span>
            )}
            <span className="shrink-0 font-key text-xs text-fg-muted">{program.key}</span>
          </h3>
          <p className="mt-0.5 truncate text-xs text-fg-muted">{program.variantsCount} {program.variantsCount === 1 ? 'variant' : 'variants'} · {program.unit.plural}</p>
        </div>
        <div className="relative z-[1] -mt-1 -mr-1 flex shrink-0 items-center gap-0.5">
          <StarToggle program={program} ops={ops} />
          <ProgramRowMenu program={program} ops={ops} access={access} onDelete={onDelete} onTemplate={onTemplate} />
        </div>
      </div>

      <p className="-mt-1 flex min-w-0 items-center gap-1.5 text-xs">
        <CustomerChip customer={program.customer} className="min-w-0" />
        {program.scheduleText ? (
          <>
            <span aria-hidden className="text-fg-muted">·</span>
            <span className="shrink-0 text-fg-secondary">{program.scheduleText}</span>
          </>
        ) : (
          <>
            <span aria-hidden className="text-fg-muted">·</span>
            <span className="shrink-0 text-fg-muted">No schedule</span>
          </>
        )}
      </p>

      <div className="flex min-h-6 items-center gap-2">
        <ProgramStatusPill status={program.archivedAt ? 'archived' : program.status} />
        {program.health ? <span className="relative z-[1]"><HealthWithBasis health={program.health} basis={program.healthBasis} auto={program.healthAuto} size="sm" /></span> : null}
        <span className="flex-1" />
        {risk ? (
          <span className="relative z-[1] inline-flex shrink-0" title={minimumRiskTitle(program) ?? undefined}>
            <Badge tone="warning" size="sm" icon={<TriangleAlert aria-hidden />} className="whitespace-nowrap">
              {risk}
            </Badge>
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3 border-y border-border-subtle py-3">
        <Metric label="This month" value={hidden ? formatQty(program.month.units) : formatCents(program.month.revenueCents ?? '0')} aside={<span className="truncate text-2xs text-fg-muted">{hidden ? program.unit.plural : unitLabel(program.month.units, program.unit)}</span>} />
        <Metric
          label="Forecast"
          value={hidden ? <span className="text-fg-muted">Hidden</span> : program.month.forecastCents === null ? <span className="text-fg-muted">None yet</span> : formatCents(program.month.forecastCents)}
          aside={!hidden && program.month.targetBp !== null ? <span className="relative z-[1]"><TargetChip targetBp={program.month.targetBp} /></span> : program.health ? <span className="truncate text-2xs text-fg-muted">No target set</span> : null}
        />
        <Metric label="Today" value={program.today.builds === 0 ? <span className="text-fg-muted">No builds</span> : `${program.today.done} of ${program.today.builds}`}>
          {program.today.builds > 0 ? <ProgressBar value={todayPercent} size="sm" tone={program.today.done === program.today.builds ? 'success' : 'primary'} label={`${program.today.done} of ${program.today.builds} builds done today`} className="mt-1.5" /> : <span className="min-h-5 text-2xs text-fg-muted">Nothing planned</span>}
        </Metric>
      </div>

      <UnitsSparkline points={program.sparkline} unit={program.unit} />

      <div className="mt-auto flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          {program.owner ? <PersonAvatar userId={program.owner.id} size="xs" showName firstNameOnly /> : null}
          {program.pulseJob ? (
            <Tooltip content={`Pulse job ${program.pulseJob.number} · ${program.pulseJob.name}`}>
              <span tabIndex={0} className="relative z-[1] shrink-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus">
                <Badge tone="neutral" size="sm" className="font-key">{program.pulseJob.number}</Badge>
              </span>
            </Tooltip>
          ) : null}
        </span>
        <span className="shrink-0 text-fg-muted" suppressHydrationWarning>
          {hydrated ? `Updated ${formatRelative(program.updatedAt)}` : 'Updated'}
        </span>
      </div>
    </article>
  );
}

export function ProgramCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="ks-skeleton size-9 rounded-md" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="ks-skeleton h-4 w-2/3 rounded-sm" />
          <div className="ks-skeleton h-3 w-1/2 rounded-sm" />
        </div>
      </div>
      <div className="ks-skeleton h-5 w-24 rounded-full" />
      <div className="grid grid-cols-3 gap-3 border-y border-border-subtle py-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <div className="ks-skeleton h-3 w-12 rounded-sm" />
            <div className="ks-skeleton h-5 w-16 rounded-sm" />
          </div>
        ))}
      </div>
      <div className="ks-skeleton h-9 w-full rounded-sm" />
      <div className="ks-skeleton h-4 w-full rounded-sm" />
    </div>
  );
}
