'use client';
/**
 * Program UI atoms (docs/programs/SPEC.md 5, 10.2 L3): chips, pills and badges that every program
 * screen shares, so the directory, the workspace, Floor today, the drawer and the palette all speak
 * with one look. Colors come only from tokens and the label palette.
 */
import Link from 'next/link';
import { createElement, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, EyeOff, Lock, OctagonAlert, Repeat2, Target, Ban, Briefcase, Receipt, Tag, Hand } from 'lucide-react';
import { Badge, Tooltip, cn, labelColorStyle, type BadgeTone } from '@/components/ui';
import { ENTITY_ICONS } from '@/components/pm';
import { POSTING_LABELS, PRICE_SOURCE_LABELS, PROGRAM_STATUS_LABELS, type Posting, type PriceSource, type ProjectStatus } from '@/lib/constants';
import type { Health, HealthBasis, IsoDate } from '@/lib/program-types';
import { programHref } from './live-pages';
import { HEALTH_TEXT, healthBasisText, lockText, paletteColor, targetText, targetTone } from './format';

/* ---------------------------------------------------------------------------------------------- */
/* Program identity                                                                               */
/* ---------------------------------------------------------------------------------------------- */

/** The program glyph tile. Programs default to the repeat glyph in their color. */
export function ProgramIcon({ icon, color, size = 20, className }: { readonly icon?: string | null; readonly color?: string | null; readonly size?: number; readonly className?: string }) {
  const glyph = (icon && ENTITY_ICONS[icon]) || Repeat2;
  const tone = paletteColor(color);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md', className)}
      style={{ width: size, height: size, background: `var(--label-${tone}-subtle)`, color: `var(--label-${tone}-text)` }}
    >
      {createElement(glyph, { style: { width: Math.round(size * 0.62), height: Math.round(size * 0.62) } })}
    </span>
  );
}

export interface ProgramChipProps {
  readonly program: { readonly key: string; readonly name: string; readonly color?: string | null; readonly icon?: string | null };
  /** Link to the program overview (default true). */
  readonly link?: boolean;
  readonly showName?: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** Program key chip: icon, key in the key font, and the name. Links to the program. */
export function ProgramChip({ program, link: wantLink = true, showName = true, size = 'md', className }: ProgramChipProps) {
  // Links only once the program page exists (live-pages.ts).
  const href = wantLink ? programHref(program.key) : null;
  const link = href !== null;
  const body = (
    <>
      <ProgramIcon icon={program.icon} color={program.color} size={size === 'sm' ? 14 : 16} />
      <span className="font-key text-fg-secondary">{program.key}</span>
      {showName ? <span className="min-w-0 truncate text-fg">{program.name}</span> : null}
    </>
  );
  const classes = cn(
    'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm border border-border-subtle bg-panel font-medium',
    size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-xs',
    link && 'outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
    className,
  );
  if (!link) return <span className={classes} title={program.name}>{body}</span>;
  return (
    <Link href={href} className={classes} title={`Open ${program.name}`} data-testid={`program-chip-${program.key}`}>
      {body}
    </Link>
  );
}

const STATUS_TONE: Readonly<Record<ProjectStatus, BadgeTone>> = {
  planning: 'neutral',
  active: 'success',
  on_hold: 'warning',
  completed: 'neutral',
  archived: 'neutral',
};

/** Running (positive), Paused (caution), Setting up, Ended or Archived (neutral): the shared Pill. */
export function ProgramStatusPill({ status, className }: { readonly status: ProjectStatus; readonly className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {PROGRAM_STATUS_LABELS[status]}
    </Badge>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Variants                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/** The variant color dot. Color is never the only signal: it always sits next to the name. */
export function VariantDot({ color, size = 8, className }: { readonly color: string | null | undefined; readonly size?: number; readonly className?: string }) {
  const tone = paletteColor(color, 'gray');
  return <span aria-hidden className={cn('inline-block shrink-0 rounded-full', className)} style={{ width: size, height: size, background: `var(--label-${tone})` }} />;
}

export interface VariantChipProps {
  readonly name: string;
  readonly color?: string | null;
  readonly sku?: string | null;
  readonly size?: 'sm' | 'md';
  readonly onClick?: () => void;
  readonly className?: string;
}

/** Variant chip: color dot, name, and the SKU in the key font when asked. */
export function VariantChip({ name, color, sku, size = 'sm', onClick, className }: VariantChipProps) {
  const tone = paletteColor(color, 'gray');
  const classes = cn(
    'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-[var(--lc-subtle)] font-medium text-fg',
    size === 'sm' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs',
    onClick && 'cursor-pointer outline-none hover:shadow-[inset_0_0_0_100px_var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-focus',
    className,
  );
  const body = (
    <>
      <VariantDot color={color} size={size === 'sm' ? 6 : 8} />
      <span className="min-w-0 truncate">{name}</span>
      {sku ? <span className="shrink-0 font-key text-fg-muted">{sku}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={classes} style={labelColorStyle(tone)} onClick={onClick} title={sku ? `${name} · ${sku}` : name}>
        {body}
      </button>
    );
  }
  return (
    <span className={classes} style={labelColorStyle(tone)} title={sku ? `${name} · ${sku}` : name}>
      {body}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Money facts                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

const PRICE_FROM_TONE: Readonly<Record<PriceSource, BadgeTone>> = {
  build: 'info',
  variant: 'info',
  card: 'neutral',
  job: 'success',
  none: 'warning',
};

const PRICE_FROM_ICON: Readonly<Record<PriceSource, ReactNode>> = {
  build: <Hand aria-hidden />,
  variant: <Tag aria-hidden />,
  card: <Receipt aria-hidden />,
  job: <Briefcase aria-hidden />,
  none: <Ban aria-hidden />,
};

const PRICE_FROM_TIP: Readonly<Record<PriceSource, string>> = {
  build: 'A rate typed on this build. It beats the price card.',
  variant: 'The variant rate on the price card in force that day.',
  card: 'The card rate in force that day.',
  job: 'The price on the Pulse job this day goes to.',
  none: 'No price was found for this day, so it earns nothing until one is set.',
};

/** "Price from" chip: Build rate, Variant rate, Card rate, Job price or No price. */
export function PriceFromChip({ source, ruleText, className }: { readonly source: PriceSource; readonly ruleText?: string | null; readonly className?: string }) {
  const tip = ruleText ? `${PRICE_FROM_TIP[source]} ${ruleText}.` : PRICE_FROM_TIP[source];
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`Price from: ${PRICE_SOURCE_LABELS[source]}. ${tip}`}>
        <Badge tone={PRICE_FROM_TONE[source]} icon={PRICE_FROM_ICON[source]} className={className}>
          {PRICE_SOURCE_LABELS[source]}
        </Badge>
      </span>
    </Tooltip>
  );
}

export interface RevenueGoesToChipProps {
  readonly posting: Posting;
  /** The Pulse job number when the day goes to a job ("J-1040"). */
  readonly jobNumber?: string | null;
  /** The program key when the day goes to the program. */
  readonly programKey?: string | null;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** Where a build day's revenue goes: a Pulse job, this program, or Not billed (warning). */
export function RevenueGoesToChip({ posting, jobNumber, programKey, className }: RevenueGoesToChipProps) {
  const label = posting === 'unbilled' ? POSTING_LABELS.unbilled : posting === 'program' ? (programKey ? `${programKey} program` : POSTING_LABELS.program) : jobNumber ? `Pulse job ${jobNumber}` : POSTING_LABELS[posting];
  const tone = posting === 'unbilled' ? 'warning' : posting === 'program' ? 'neutral' : 'success';
  const tip =
    posting === 'unbilled'
      ? 'This build is not billed anywhere. Move it to a program or bill it to a Pulse job.'
      : posting === 'program'
        ? 'Revenue counts in this program.'
        : posting === 'build_job'
          ? "Revenue goes to this build's own Pulse job."
          : "Revenue goes to the program's Pulse job, so Pulse can show cost and margin.";
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`Revenue goes to ${label}. ${tip}`}>
        <Badge tone={tone} icon={posting === 'unbilled' ? <AlertTriangle aria-hidden /> : posting === 'program' ? <Repeat2 aria-hidden /> : <CircleDollarSign aria-hidden />} className={className}>
          {label}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** "105% of target" in success, warning or danger. The number is always in the text. */
export function TargetChip({ targetBp, className }: { readonly targetBp: number; readonly className?: string }) {
  const tone = targetTone(targetBp);
  return (
    <Badge tone={tone} icon={<Target aria-hidden />} className={className}>
      {targetText(targetBp)}
    </Badge>
  );
}

const HEALTH_TONE: Readonly<Record<Health, 'success' | 'warning' | 'danger'>> = { on_track: 'success', at_risk: 'warning', off_track: 'danger' };

export function ProgramHealthIcon({ health, className = 'size-3' }: { readonly health: Health; readonly className?: string }) {
  const Icon = health === 'on_track' ? CheckCircle2 : health === 'at_risk' ? AlertTriangle : OctagonAlert;
  return <Icon aria-hidden className={className} />;
}

export interface HealthWithBasisProps {
  readonly health: Health | null;
  readonly basis: HealthBasis | null;
  readonly auto: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** Health chip with a tip that says what it is based on; ", set by hand" in its words when an owner chose it. */
export function HealthWithBasis({ health, basis, auto, className }: HealthWithBasisProps) {
  const tip = healthBasisText(basis, auto);
  if (!health) {
    return (
      <Tooltip content={tip}>
        <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`No health yet. ${tip}`}>
          <Badge tone="neutral" className={className}>
            No health yet
          </Badge>
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Tooltip content={tip}>
        <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`${HEALTH_TEXT[health]}. ${tip}`} data-testid="program-health" data-health={health}>
          <Badge tone={HEALTH_TONE[health]} icon={<ProgramHealthIcon health={health} />}>
            {HEALTH_TEXT[health]}
            {/* The second signal goes in the words, never as a second badge beside the pill. */}
            {!auto ? <span className="font-normal">, set by hand</span> : null}
          </Badge>
        </span>
      </Tooltip>
    </span>
  );
}

export interface LockBadgeProps {
  readonly lockedThrough: IsoDate;
  /** Which app closed it: shown in the tip. */
  readonly closedBy?: readonly ('program' | 'pulse')[];
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/** "Closed through Oct 31" with a lock icon and a tip that names who closed it. */
export function LockBadge({ lockedThrough, closedBy = ['program'], className }: LockBadgeProps) {
  const who = closedBy.includes('program') && closedBy.includes('pulse') ? 'this program and Pulse' : closedBy.includes('pulse') ? 'Pulse' : 'this program';
  const tip = `Months through ${lockText(lockedThrough).replace('Closed through ', '')} were closed in ${who}. Output, prices and fees on those days cannot change. An owner can reopen a month with a reason.`;
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label={`${lockText(lockedThrough)}. ${tip}`} data-testid="program-lock">
        <Badge tone="neutral" icon={<Lock aria-hidden />} className={className}>
          {lockText(lockedThrough)}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** A small lock icon for one locked cell or row, with its reason. */
export function LockIcon({ reason, className }: { readonly reason: string; readonly className?: string }) {
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} aria-label={`Locked. ${reason}`} className={cn('inline-flex shrink-0 rounded-xs text-fg-muted outline-none focus-visible:outline-2 focus-visible:outline-focus', className)}>
        <Lock aria-hidden className="size-3.5" />
      </span>
    </Tooltip>
  );
}

/** The one line shown where money would be for people without money access (M8). */
export function MoneyHiddenNote({ className }: { readonly className?: string }) {
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-xs text-fg-muted', className)} data-testid="money-hidden-note">
      <EyeOff aria-hidden className="size-3.5 shrink-0" />
      Money is hidden for your role.
    </p>
  );
}
