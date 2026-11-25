'use client';
/**
 * StatRow, StatTile, Delta and Meter (docs/design/UI-CLEANUP.md section 2, "Stat row").
 *
 * A tile is always a link: the number goes to the list it counts. A change is colored text with an
 * arrow, never a chip. Meters and sparklines use the app's data color (`--dash-data`) and switch to
 * a status tone only when the value crosses a line that matters.
 */
import * as React from 'react';
// Each piece imports the stylesheet itself: the package is side effect free apart from CSS, so a bundler may skip index.ts.
import './dashboard.css';
import { DashLink } from './link';
import { cx } from './pill';

export type DeltaTone = 'good' | 'bad' | 'neutral';
export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaProps {
  /** The change as text: "+$18,799", "-6%", "+2 points". */
  readonly text: string;
  readonly direction: DeltaDirection;
  readonly tone: DeltaTone;
  /** Read out instead of the arrow, e.g. "Up, better". */
  readonly srLabel?: string;
}

const ARROW_PATH: Readonly<Record<DeltaDirection, string>> = {
  up: 'M4 12 12 4M6 4h6v6',
  down: 'M4 4l8 8M12 6v6H6',
  flat: 'M3 8h10',
};

const DIRECTION_WORD: Readonly<Record<DeltaDirection, string>> = { up: 'Up', down: 'Down', flat: 'No change' };
const TONE_WORD: Readonly<Record<DeltaTone, string>> = { good: ', better', bad: ', worse', neutral: '' };

export function Delta({ text, direction, tone, srLabel }: DeltaProps) {
  return (
    <span className="ks-dash-delta" data-tone={tone}>
      <svg aria-hidden viewBox="0 0 16 16" className="ks-dash-delta-arrow">
        <path d={ARROW_PATH[direction]} />
      </svg>
      <span className="ks-dash-sr">{srLabel ?? `${DIRECTION_WORD[direction]}${TONE_WORD[tone]}:`} </span>
      {text}
    </span>
  );
}

export interface StatTileProps {
  readonly label: string;
  readonly value: React.ReactNode;
  /**
   * Where the number goes. Required on purpose: on a dashboard a headline number is never a dead
   * end. Pass `null` only on the page the number already explains (the tile is the destination).
   */
  readonly href: string | null;
  readonly delta?: DeltaProps;
  /** Words next to the change: "vs October". Leave it out when the header already says it. */
  readonly deltaLabel?: React.ReactNode;
  /** One short line under the value, e.g. "Company margin 24.8%". */
  readonly caption?: React.ReactNode;
  /** A sparkline or other small trend, drawn in `--dash-data`. Give it its own label or `aria-hidden`. */
  readonly trend?: React.ReactNode;
  /** How the number is worked out, as a short tooltip. */
  readonly help?: string;
  /**
   * A control that opens the math ("How we got this"). It sits in the corner outside the link, so a
   * button is never nested in an anchor, and it stays quiet until the tile is hovered or focused.
   */
  readonly explain?: React.ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function StatTile({ label, value, href, delta, deltaLabel, caption, trend, help, explain, className, ...rest }: StatTileProps) {
  const content = (
    <>
      <span className="ks-dash-stat-label">{label}</span>
      <span className="ks-dash-stat-body">
        <span className="ks-dash-stat-value">{value}</span>
        {/* Not hidden: a trend that reads itself out (role="img" with a summary) stays readable. */}
        {trend ? <span className="ks-dash-stat-trend">{trend}</span> : null}
      </span>
      {delta || caption ? (
        <span className="ks-dash-stat-foot">
          {delta ? <Delta {...delta} /> : null}
          {delta && deltaLabel ? <span className="ks-dash-stat-caption">{deltaLabel}</span> : null}
          {caption ? <span className="ks-dash-stat-caption">{caption}</span> : null}
        </span>
      ) : null}
    </>
  );
  return (
    <div className={cx('ks-dash-stat', className)} data-linked={href ? '' : undefined} data-testid={rest['data-testid']}>
      {href ? (
        <DashLink href={href} className="ks-dash-stat-link" title={help}>
          {content}
        </DashLink>
      ) : (
        <div className="ks-dash-stat-link" title={help}>
          {content}
        </div>
      )}
      {explain ? <span className="ks-dash-stat-explain">{explain}</span> : null}
    </div>
  );
}

/** How many columns a row of `count` tiles uses: four at most, and never a lonely tile on the last row. */
export function statColumns(count: number): number {
  if (count <= 4) return Math.max(1, count);
  return count % 4 === 0 ? 4 : 3;
}

/** A row of tiles: up to four across, six as three and three. */
export function StatRow({ children, className, label, ...rest }: { readonly children: React.ReactNode; readonly className?: string; readonly label?: string; readonly 'data-testid'?: string }) {
  const count = React.Children.toArray(children).filter(Boolean).length;
  return (
    <div className={cx('ks-dash-stats', className)} data-cols={statColumns(count)} role="group" aria-label={label} data-testid={rest['data-testid']}>
      {children}
    </div>
  );
}

export type MeterTone = 'data' | 'positive' | 'caution' | 'critical' | 'quiet';

export interface MeterProps {
  /** 0 to 1. Values outside are clamped. */
  readonly value: number;
  readonly label: string;
  readonly tone?: MeterTone;
  readonly className?: string;
}

export function Meter({ value, label, tone = 'data', className }: MeterProps) {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(safe * 100);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cx('ks-dash-meter', className)}
      data-tone={tone}
    >
      <span className="ks-dash-meter-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
