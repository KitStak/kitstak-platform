'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDifference, percentDifference } from '@/lib/grid-defs/counts/count-math';
import { pillStyle, TONES, type ToneName } from '@/lib/status-colors';

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

function Pill({
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
  const toneName = bandTone(band);
  const tone = TONES[toneName];
  return (
    <span
      {...dataAttrs}
      data-band={band}
      title={title}
      style={pillStyle(tone)}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums',
        DARK_BY_TONE[toneName],
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

/** Dark-theme classes for the three band tones (same palette as the count pills). */
const DARK_BY_TONE: Partial<Record<ToneName, string>> = {
  grey: '[[data-theme=dark]_&]:!bg-[rgba(148,163,184,0.14)] [[data-theme=dark]_&]:!text-[#CBD5E1]',
  amber: '[[data-theme=dark]_&]:!bg-[rgba(245,158,11,0.16)] [[data-theme=dark]_&]:!text-[#FCD34D]',
  red: '[[data-theme=dark]_&]:!bg-[rgba(239,68,68,0.18)] [[data-theme=dark]_&]:!text-[#FCA5A5]',
};

/** "% Difference" pill: grey at 0, amber within tolerance, red beyond (either sign), arrow for direction. */
export function DifferenceBadge({
  value,
  suffix = '%',
  className,
}: {
  readonly value: number | null | undefined;
  readonly suffix?: string;
  readonly className?: string;
}) {
  if (value === null || value === undefined) return <span className="text-faint">—</span>;
  const band = differenceBand(value);
  return (
    <Pill
      band={band}
      sign={value}
      className={className}
      title={`${formatDifference(value)}${suffix}: ${BAND_LABEL[band]}`}
      dataAttrs={{ 'data-difference': value }}
    >
      {formatDifference(value)}
      {suffix}
    </Pill>
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
    <Pill
      band={band}
      sign={value}
      title={`${label} units${pct === null ? '' : ` (${formatDifference(pct)}%)`}: ${BAND_LABEL[band]}`}
    >
      {label}
    </Pill>
  );
}
