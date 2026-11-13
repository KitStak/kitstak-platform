'use client';
/**
 * Token-colored SVG progress ring for the Getting-started guide (cross-app contract:
 * one progress treatment — a circular ring, primary tone until 100%, then success,
 * with the percent label in the center). The arc animates via a CSS transition on
 * stroke-dashoffset, disabled under prefers-reduced-motion.
 */
import { cn } from '@/components/ui';

export interface ProgressRingProps {
  /** 0–100. */
  readonly percent: number;
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly className?: string;
}

export function ProgressRing({ percent, size = 44, strokeWidth = 4, className }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${clamped}% of setup complete`}
      data-testid="setup-guide-progress"
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
          stroke={clamped === 100 ? 'var(--success)' : 'var(--primary)'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset,stroke] duration-[var(--duration-slower)] ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute text-2xs font-semibold text-fg tabular-nums">{clamped}%</span>
    </span>
  );
}
