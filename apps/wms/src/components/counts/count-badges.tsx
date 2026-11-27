'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDifference, percentDifference } from '@/lib/grid-defs/counts/count-math';
import type { ToneName } from '@/lib/status-colors';

/**
 * % Difference tolerance band, coloured by ABSOLUTE magnitude (an overage is as much an accuracy
 * failure as a shortage): 0 neutral grey, within ±5 % amber, beyond ±5 % red in both directions.
 * The sign is shown with an arrow (and the +/− in the number), never with colour.
 */
export const DIFFERENCE_TOLERANCE_PCT = 5;
export const DIFFERENCE_THRESHOLD_HINT =
  'Coloured by size, not direction: 0% grey · within ±5% amber · beyond ±5% red (shortage or overage). The arrow shows over (↑) or short (↓).';

export type DifferenceBand = 'none' | 'minor' | 'short' | 'over';

export function differenceBand(value: number): DifferenceBand {
  if (value === 0) return 'none';
  if (Math.abs(value) <= DIFFERENCE_TOLERANCE_PCT) return 'minor';
  return value < 0 ? 'short' : 'over';
}

/** Tone for a band: magnitude only. "short" and "over" share the red tone. */
export function bandTone(band: DifferenceBand): ToneName {
  return band === 'none' ? 'grey' : band === 'minor' ? 'amber' : 'red';
}

const BAND_LABEL: Record<DifferenceBand, string> = {
  none: 'no difference',
  minor: `within the ±${DIFFERENCE_TOLERANCE_PCT}% tolerance`,
  short: `shortage beyond the ±${DIFFERENCE_TOLERANCE_PCT}% tolerance`,
  over: `overage beyond the ±${DIFFERENCE_TOLERANCE_PCT}% tolerance`,
};

/** Text colour per band tone: a difference is a number, so it is colored text, never a pill. */
const BAND_TEXT: Readonly<Partial<Record<ToneName, string>>> = {
  grey: 'text-fg-muted',
  amber: 'text-warning-text',
  red: 'text-danger-text',
};

function DifferenceText({
  band,
  sign,
  children,
  title,
  className,
  dataAttrs,
}: {
  readonly band: DifferenceBand;
  readonly sign: number;
  readonly children: React.ReactNode;
  readonly title: string;
  readonly className?: string;
  readonly dataAttrs?: Record<string, string | number>;
}) {
  return (
    <span
      {...dataAttrs}
      data-band={band}
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium tabular-nums',
        BAND_TEXT[bandTone(band)],
        className,
      )}
    >
      {sign > 0 ? (
        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
      ) : sign < 0 ? (
        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
      ) : null}
      {children}
    </span>
  );
}

/** "% Difference": muted at 0, amber within tolerance, red beyond (either sign), arrow for direction. */
export function DifferenceBadge({
  value,
  suffix = '%',
  className,
}: {
  readonly value: number | null | undefined;
  readonly suffix?: string;
  readonly className?: string;
}) {
  if (value === null || value === undefined) return <span className="text-faint">None</span>;
  const band = differenceBand(value);
  return (
    <DifferenceText
      band={band}
      sign={value}
      className={className}
      title={`${formatDifference(value)}${suffix}: ${BAND_LABEL[band]}`}
      dataAttrs={{ 'data-difference': value }}
    >
      {formatDifference(value)}
      {suffix}
    </DifferenceText>
  );
}

/**
 * Signed unit delta "+3" / "−2". With `system` (the expected qty) it takes the same band as its
 * % difference; without it any non-zero delta reads amber (size unknown).
 */
export function DeltaBadge({ value, system }: { readonly value: number; readonly system?: number | null }) {
  const pct = system === undefined || system === null ? null : percentDifference(system, system + value);
  const band: DifferenceBand = value === 0 ? 'none' : pct === null ? 'minor' : differenceBand(pct);
  const label = value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
  return (
    <DifferenceText
      band={band}
      sign={value}
      title={`${label} units${pct === null ? '' : ` (${formatDifference(pct)}%)`}: ${BAND_LABEL[band]}`}
    >
      {label}
    </DifferenceText>
  );
}
