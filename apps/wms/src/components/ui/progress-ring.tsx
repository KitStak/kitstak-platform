import * as React from 'react';
import { Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampPercent, type ProgressTone } from './progress-bar';

const STROKE: Readonly<Record<ProgressTone, string>> = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export interface ProgressRingProps {
  readonly value: number;
  readonly max?: number;
  readonly size?: number;
  readonly thickness?: number;
  readonly tone?: ProgressTone;
  /** Centre content: "percent" (default), "truck" (Progress Today), or custom node. */
  readonly center?: 'percent' | 'truck' | React.ReactNode;
  readonly label?: string;
  readonly className?: string;
}

/** Circular progress (wizard rail %, dashboard "Progress Today" with the truck icon). */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  thickness = 6,
  tone = 'primary',
  center = 'percent',
  label = 'Progress',
  className,
}: ProgressRingProps) {
  const pct = clampPercent(value, max);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  const content =
    center === 'percent' ? (
      <span
        className="text-sm font-semibold tabular-nums text-foreground"
        style={{ fontSize: Math.max(11, size * 0.22) }}
      >
        {Math.round(pct)}%
      </span>
    ) : center === 'truck' ? (
      <Truck className="text-secondary" style={{ width: size * 0.36, height: size * 0.36 }} aria-hidden />
    ) : (
      center
    );
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--neutral-soft)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{content}</span>
    </div>
  );
}
