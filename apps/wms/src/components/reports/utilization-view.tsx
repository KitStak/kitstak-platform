'use client';

/**
 * Location Utilization presentation: a colour-coded band pill, a utilization bar with a
 * percent label, and a band summary whose chips filter the grid. Estimated capacity (legacy
 * capacity units) is hatched and labelled so it is never read as an exact figure.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { pillStyle, TONES } from '@/lib/status-colors';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  BAND_TONE,
  formatUtilizationPct,
  UTILIZATION_BANDS,
  type UtilizationBand,
} from '@/lib/grid-defs/reports/analysis';
import type { ReportRow } from './report-cells';

const toneOf = (band: string) => TONES[BAND_TONE[band as UtilizationBand] ?? 'grey'];

export function BandPill({ band, estimated }: { readonly band: string; readonly estimated?: boolean }) {
  const tone = toneOf(band);
  return (
    <span
      data-band={band}
      style={pillStyle(tone)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold leading-4"
    >
      {band}
      {estimated && band !== 'Empty' && band !== 'No Capacity Set' ? (
        <span className="font-medium opacity-75">· est.</span>
      ) : null}
    </span>
  );
}

/** Bar width is capped at 100 %; over-capacity rows fill the bar and keep the true figure as text. */
export function UtilizationBar({
  pct,
  band,
  estimated,
}: {
  readonly pct: number | null;
  readonly band: string;
  readonly estimated: boolean;
}) {
  if (pct === null) return <span className="text-faint">None</span>;
  const tone = toneOf(band);
  const width = Math.max(Math.min(pct, 100), pct > 0 ? 2 : 0);
  const label = formatUtilizationPct(pct);
  return (
    <span
      className="flex min-w-0 items-center gap-2"
      title={
        estimated
          ? `${label} (estimated from legacy capacity units)`
          : pct > 100
            ? `${label}: stock exceeds capacity ${(pct / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}×. Check the location's dimensions or capacity, or move stock.`
            : label
      }
    >
      <span
        role="meter"
        aria-label="Utilization"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-valuetext={label}
        className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${width}%`,
            backgroundColor: tone.fg,
            ...(estimated
              ? {
                  backgroundImage:
                    'repeating-linear-gradient(135deg, rgba(255,255,255,.45) 0 3px, transparent 3px 6px)',
                }
              : {}),
          }}
        />
      </span>
      <span className="w-[68px] shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {label}
      </span>
    </span>
  );
}

export const UTILIZATION_OVERRIDES: Readonly<Record<string, (row: ReportRow) => React.ReactNode>> = {
  utilizationPct: (row) => (
    <UtilizationBar
      pct={typeof row.utilizationPct === 'number' ? row.utilizationPct : null}
      band={String(row.band ?? '')}
      estimated={Boolean(row.estimated)}
    />
  ),
  band: (row) => <BandPill band={String(row.band ?? '')} estimated={Boolean(row.estimated)} />,
};

interface Summary {
  readonly total: number;
  readonly estimated: number;
  readonly bands: readonly { band: string; count: number }[];
}

/** Band summary chips: click to filter the grid to one band (click again to clear). */
export function UtilizationSummaryBar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = useApiQuery<Summary>(
    ['report-utilization-summary'],
    '/api/reports/location-utilization/summary',
    { staleTime: 30_000 },
  );
  const summary = q.data?.data;
  const active = params.get('f.band');
  const hrefFor = (band: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (band) next.set('f.band', `in:${band}`);
    else next.delete('f.band');
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  if (q.isLoading) return <div className="h-[30px] animate-pulse rounded-md bg-surface-sunken" aria-hidden />;
  if (!summary) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Locations by utilization band"
      data-testid="utilization-summary"
    >
      <span className="mr-1 text-xs font-semibold text-secondary">
        {summary.total.toLocaleString('en-US')} locations
      </span>
      {UTILIZATION_BANDS.map((band) => {
        const count = summary.bands.find((b) => b.band === band)?.count ?? 0;
        const tone = toneOf(band);
        const isActive = active === `in:${band}`;
        return (
          <Link
            key={band}
            href={hrefFor(isActive ? null : band)}
            scroll={false}
            aria-pressed={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isActive ? 'border-transparent' : 'border-border bg-surface text-body hover:bg-surface-sunken',
              count === 0 && !isActive && 'opacity-60',
            )}
            style={isActive ? { backgroundColor: tone.bg, color: tone.fg } : undefined}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: tone.fg }} />
            {band}
            <span className="font-semibold tabular-nums">{count.toLocaleString('en-US')}</span>
          </Link>
        );
      })}
      {summary.estimated > 0 ? (
        <span className="ml-1 text-xs text-secondary">
          · {summary.estimated.toLocaleString('en-US')} on estimated capacity (hidden by the Estimated chip)
        </span>
      ) : null}
    </div>
  );
}
