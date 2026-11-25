'use client';
import { cn } from '@/components/ui';

export interface ProgressRingProps {
  /** 0–100. */
  readonly percent: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly className?: string;
  /** Hide the centered percent label (e.g. when a check icon replaces it). */
  readonly showLabel?: boolean;
}

/**
 * Token-colored SVG progress ring. The arc animates via a CSS transition on
 * stroke-dashoffset, so progress changes sweep smoothly (and not at all under
 * prefers-reduced-motion).
 */
export function ProgressRing({
  percent,
  size = 44,
  strokeWidth = 4,
  className,
  showLabel = true,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${clamped}% of setup complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={clamped === 100 ? 'var(--success)' : 'var(--dash-data, var(--chart-5))'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset,stroke] duration-[var(--duration-slower)] ease-out motion-reduce:transition-none"
        />
      </svg>
      {showLabel ? (
        <span className="absolute text-2xs font-semibold text-fg tabular-nums">{clamped}%</span>
      ) : null}
    </span>
  );
}
