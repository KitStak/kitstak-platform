import type { CSSProperties, ReactNode } from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from './cn';

export interface SkeletonProps {
  readonly className?: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly rounded?: 'sm' | 'md' | 'lg' | 'full';
  readonly style?: CSSProperties;
}

/** Shimmering placeholder block. Decorative: wrap groups in an element with aria-busy. */
export function Skeleton({ className, width, height, rounded = 'sm', style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'ks-skeleton block',
        rounded === 'sm' && 'rounded-sm',
        rounded === 'md' && 'rounded-md',
        rounded === 'lg' && 'rounded-lg',
        rounded === 'full' && 'rounded-full',
        className,
      )}
      style={{ width, height, ...style }}
    />
  );
}

/** Pre-built skeleton for list rows (sidebar tree, menus, tables). */
export function SkeletonRows({ rows = 4, className }: { readonly rows?: number; readonly className?: string }) {
  const widths = ['72%', '58%', '84%', '64%', '50%', '76%'];
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-1', className)}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden className="flex h-8 items-center gap-2.5 px-2">
          <Skeleton width={16} height={16} rounded="sm" />
          <Skeleton height={10} width={widths[index % widths.length]} rounded="full" />
        </div>
      ))}
    </div>
  );
}

export interface ProgressBarProps {
  /** 0–100. Omit for indeterminate. */
  readonly value?: number;
  readonly label: string;
  readonly showValue?: boolean;
  readonly tone?: 'primary' | 'success' | 'warning' | 'danger';
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

export function ProgressBar({ value, label, showValue, tone = 'primary', size = 'md', className }: ProgressBarProps) {
  const clamped = value === undefined ? undefined : Math.min(100, Math.max(0, value));
  const fill = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning-accent',
    danger: 'bg-danger',
  }[tone];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className={cn('relative flex-1 overflow-hidden rounded-full bg-sunken', size === 'sm' ? 'h-1' : 'h-1.5')}
      >
        {clamped === undefined ? (
          <span className={cn('absolute inset-y-0 w-1/3 animate-[ks-indeterminate_1.2s_var(--ease-standard)_infinite] rounded-full', fill)} />
        ) : (
          <span
            className={cn('block h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-out', fill)}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
      {showValue && clamped !== undefined ? (
        <span className="w-9 text-right text-xs font-semibold text-fg-secondary tabular-nums">{Math.round(clamped)}%</span>
      ) : null}
    </div>
  );
}

export interface SeparatorProps {
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
  readonly decorative?: boolean;
}

export function Separator({ orientation = 'horizontal', className, decorative = true }: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn('shrink-0 bg-border-subtle', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  );
}

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
}

export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="sr-only">{children}</span>;
}
