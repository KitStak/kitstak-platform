/**
 * Pill, Tag, Count and Legend (docs/design/UI-CLEANUP.md section 1, "Pills").
 *
 * - Pill: a state. Fully round, flat tint, one optional marker (icon or dot), nothing on top of it.
 * - Tag: an identity (job key, program code, type). Square-ish and always neutral.
 * - Count: a number in a tab or nav item. Neutral unless it counts broken or overdue things.
 * - Legend: a dot and a word. Never a pill.
 */
import * as React from 'react';
// Each piece imports the stylesheet itself: the package is side effect free apart from CSS, so a bundler may skip index.ts.
import './dashboard.css';

export type PillTone = 'neutral' | 'positive' | 'caution' | 'critical' | 'info';

export const PILL_TONES: readonly PillTone[] = ['neutral', 'positive', 'caution', 'critical', 'info'];

type PillMarker =
  | { readonly icon?: React.ReactNode; readonly dot?: never }
  | { readonly dot?: boolean; readonly icon?: never };

export type PillProps = PillMarker & {
  readonly tone?: PillTone;
  readonly children: React.ReactNode;
  /** Tooltip, e.g. a second signal that used to be drawn as a dot on the pill. */
  readonly title?: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

export function Pill({ tone = 'neutral', icon, dot, children, title, className, ...rest }: PillProps) {
  return (
    <span className={cx('ks-dash-pill', className)} data-tone={tone} title={title} data-testid={rest['data-testid']}>
      {icon ? (
        <span aria-hidden className="ks-dash-pill-icon">
          {icon}
        </span>
      ) : dot ? (
        <span aria-hidden className="ks-dash-pill-dot" />
      ) : null}
      <span className="ks-dash-pill-text">{children}</span>
    </span>
  );
}

export function Tag({ children, title, className }: { readonly children: React.ReactNode; readonly title?: string; readonly className?: string }) {
  return (
    <span className={cx('ks-dash-tag', className)} title={title}>
      {children}
    </span>
  );
}

export interface CountProps {
  readonly value: number;
  readonly tone?: 'neutral' | 'critical';
  readonly label?: string;
  /**
   * `inline` (default) beside a word, in a pale fill. `icon` when the count sits on an icon (a bell),
   * where a pale fill would vanish into the bar: a solid neutral fill, still never crimson.
   */
  readonly placement?: 'inline' | 'icon';
}

export function Count({ value, tone = 'neutral', label, placement = 'inline' }: CountProps) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    <span className="ks-dash-count" data-tone={tone} data-placement={placement === 'icon' ? 'icon' : undefined}>
      {value > 99 ? '99+' : value}
      {label ? <span className="ks-dash-sr"> {label}</span> : null}
    </span>
  );
}

export interface LegendItem {
  readonly label: string;
  /** Any CSS color, normally a token: `var(--chart-1)`. */
  readonly color: string;
  /** With `onToggle`: the series is switched off in the chart. */
  readonly hidden?: boolean;
}

export interface LegendProps {
  readonly items: readonly LegendItem[];
  /**
   * Makes each entry a toggle button that shows or hides its series. It stays a dot and a word; a
   * hidden series keeps its place with a hollow dot, so nothing moves.
   */
  readonly onToggle?: (label: string) => void;
  readonly className?: string;
}

export function Legend({ items, onToggle, className }: LegendProps) {
  return (
    <ul className={cx('ks-dash-legend', className)}>
      {items.map((item) => {
        const dot = (
          <span
            aria-hidden
            className="ks-dash-legend-dot"
            data-hidden={item.hidden ? '' : undefined}
            style={item.hidden ? { borderColor: item.color } : { background: item.color }}
          />
        );
        return (
          <li key={item.label}>
            {onToggle ? (
              <button type="button" className="ks-dash-legend-toggle" aria-pressed={!item.hidden} onClick={() => onToggle(item.label)}>
                {dot}
                {item.label}
              </button>
            ) : (
              <>
                {dot}
                {item.label}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
