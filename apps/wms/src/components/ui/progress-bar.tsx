import * as React from 'react';
import { Meter, type MeterTone } from '@kitstak/ui/dashboard';
import { cn } from '@/lib/utils';

/**
 * `data` (the default) draws a quantity in the WMS data color (teal, `--dash-data`). Status tones
 * are only for a value that crossed a line that matters (over budget, done). Never crimson: a red
 * bar reads as an error (docs/design/UI-CLEANUP.md "Color is meaning").
 */
export type ProgressTone = 'data' | 'success' | 'warning' | 'danger';

const METER_TONE: Readonly<Record<ProgressTone, MeterTone>> = {
  data: 'data',
  success: 'positive',
  warning: 'caution',
  danger: 'critical',
};

export function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly tone?: ProgressTone;
  /** `sm` is the thin 4 px meter; `md` the thick 8 px meter used in dense tables and cards. */
  readonly size?: 'sm' | 'md';
  /** Accessible name. */
  readonly label?: string;
  /** Render "N%" (or custom text) to the right. */
  readonly showValue?: boolean | string;
  readonly className?: string;
}

/** A quantity bar: the shared `Meter` with an optional value to its right. */
export function ProgressBar({
  value,
  max = 100,
  tone = 'data',
  size = 'md',
  label = 'Progress',
  showValue,
  className,
}: ProgressBarProps) {
  const pct = clampPercent(value, max);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Meter
        value={pct / 100}
        label={label}
        tone={METER_TONE[tone]}
        size={size === 'sm' ? 'thin' : 'thick'}
      />
      {showValue ? (
        <span className="shrink-0 text-2xs font-semibold tabular-nums text-secondary">
          {typeof showValue === 'string' ? showValue : `${Math.round(pct)}%`}
        </span>
      ) : null}
    </div>
  );
}
