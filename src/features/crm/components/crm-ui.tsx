'use client';
/** Small CRM building blocks: cards, metric tiles, stage pills, user chips, error blocks. */
import type { ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import {
  Avatar,
  Button,
  Skeleton,
  StatusPill,
  Tooltip,
  cn,
  labelColorStyle,
  toLabelColor,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks/cache';
import type { CrmLabelDto, CrmUserDto } from '@/server/services/crm-contracts';

export function CrmCard({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
  testId,
  id,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly testId?: string;
  readonly id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn('flex min-w-0 flex-col rounded-lg border border-border-subtle bg-panel shadow-xs', className)}
    >
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h2 id={headingId} className="font-heading text-md font-semibold text-fg">
            {title}
          </h2>
          {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      <div className={cn('min-w-0 flex-1', bodyClassName ?? 'p-4 sm:p-5')}>{children}</div>
    </section>
  );
}

export function MetricTile({
  label,
  value,
  exact,
  hint,
  tone = 'default',
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly exact?: string;
  readonly hint?: ReactNode;
  readonly tone?: 'default' | 'primary' | 'success' | 'danger';
  readonly testId?: string;
}) {
  const valueNode = (
    <span
      tabIndex={exact ? 0 : undefined}
      className={cn(
        'rounded-sm font-heading text-xl font-semibold tabular-nums tracking-[-0.01em] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        tone === 'primary' && 'text-primary-text',
        tone === 'success' && 'text-success-text',
        tone === 'danger' && 'text-danger-text',
        tone === 'default' && 'text-fg',
      )}
    >
      {value}
    </span>
  );
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border-subtle bg-panel px-4 py-3 shadow-xs transition-shadow duration-[var(--duration-fast)] hover:shadow-sm"
    >
      <span className="truncate text-sm font-medium text-fg-secondary">{label}</span>
      {exact ? <Tooltip content={exact}>{valueNode}</Tooltip> : valueNode}
      {hint ? <span className="truncate text-xs text-fg-muted">{hint}</span> : null}
    </div>
  );
}

export function StagePill({ label, className }: { readonly label: CrmLabelDto | null; readonly className?: string }) {
  if (!label) return <span className={cn('text-sm text-fg-muted', className)}>No stage</span>;
  return <StatusPill label={label.name} color={toLabelColor(label.color)} className={cn('min-w-0 max-w-40', className)} />;
}

/** Soft label chip (tags, health) — tinted surface with AA text in both themes. */
export function SoftLabel({ label }: { readonly label: CrmLabelDto }) {
  return (
    <span
      style={labelColorStyle(toLabelColor(label.color))}
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[var(--lc-subtle)] px-2.5 text-xs font-semibold text-[var(--lc-text)]"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--lc-bg)]" />
      {label.name}
    </span>
  );
}

export function UserChip({ user, size = 'sm' }: { readonly user: CrmUserDto | null; readonly size?: 'xs' | 'sm' }) {
  if (!user) return <span className="text-sm text-fg-muted">Unassigned</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={user.name} src={user.image} size={size} colorKey={user.id} />
      <span className="truncate text-sm text-fg">{user.name}</span>
    </span>
  );
}

export function ErrorBlock({
  error,
  title = 'Couldn’t load this section',
  onRetry,
  className,
}: {
  readonly error: unknown;
  readonly title?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-3 rounded-lg border border-danger-subtle bg-danger-subtle/40 p-4', className)}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />
        <div>
          <p className="text-base font-semibold text-fg">{title}</p>
          <p className="text-sm text-fg-secondary">{errorMessage(error)}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" leadingIcon={<RotateCw aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Token-styled radio (the design system ships Checkbox but no Radio yet). A visually hidden
 * native input keeps keyboard semantics (arrow keys within a name group) and form behaviour;
 * the drawn ring/dot matches Checkbox sizing, focus ring and disabled treatment.
 */
export function Radio({
  name,
  value,
  checked,
  onChange,
  disabled,
  label,
  className,
  testId,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** Accessible name when the radio is not wrapped in a visible <label>. */
  readonly label?: string;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0', className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        onChange={() => onChange(value)}
        className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none flex size-4 items-center justify-center rounded-full border bg-panel transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)]',
          'peer-hover:border-border-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-50',
          checked ? 'border-primary bg-primary' : 'border-border-strong',
        )}
      >
        <span className={cn('size-1.5 rounded-full bg-primary-fg transition-transform duration-[var(--duration-fast)]', checked ? 'scale-100' : 'scale-0')} />
      </span>
    </span>
  );
}

export function CardSkeleton({ rows = 4, height = 32 }: { readonly rows?: number; readonly height?: number }) {
  return (
    <div className="flex flex-col gap-2" data-skeleton>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} rounded="md" style={{ opacity: 1 - index * 0.12 }} />
      ))}
    </div>
  );
}

/** Horizontal proportional bar (funnel, quota, forecast). */
export function Meter({
  value,
  max,
  color,
  className,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly color: string;
  readonly className?: string;
  readonly label?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className="h-full origin-left rounded-full transition-transform duration-[var(--duration-slow)] ease-[var(--ease-enter)]"
        style={{ background: color, transform: `scaleX(${ratio})`, width: '100%' }}
      />
    </div>
  );
}
