'use client';

/** Small presentational pieces shared by the M08 dialogs, wizard and detail page. */
import * as React from 'react';
import { FieldError, FieldLabel } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export function Field({
  id,
  label,
  required,
  info,
  error,
  className,
  children,
}: {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly error?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div data-field={id} className={cn('flex flex-col gap-1', className)}>
      <FieldLabel htmlFor={id} required={required} info={info}>
        {label}
      </FieldLabel>
      {children}
      <FieldError id={`${id}-err`} message={error} />
    </div>
  );
}

/** Date → "YYYY-MM-DD" in local time (lot expiry / production dates are calendar dates). */
export function toDateOnly(d: Date | null): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Focuses the first `[data-field]` with an error inside `root`. */
export function focusFirst(root: HTMLElement | null, keys: readonly string[]): void {
  const first = keys[0];
  if (!first || !root) return;
  // The control itself first (input / textarea), then a button-based control. A selector list would
  // match the label's (i) info button first (document order) and pop its tooltip over the drawer.
  const f = `[data-field="${CSS.escape(first)}"]`;
  requestAnimationFrame(() =>
    (
      root.querySelector<HTMLElement>(`${f} input:not([type=hidden]), ${f} textarea`) ??
      root.querySelector<HTMLElement>(`${f} [role=combobox], ${f} button:not([data-audit-skip])`)
    )?.focus(),
  );
}

export function TrackFlag({ label, on }: { readonly label: string; readonly on: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
        on ? 'bg-primary-soft text-primary' : 'bg-surface-sunken text-faint',
      )}
    >
      {label}: {on ? 'Yes' : 'No'}
    </span>
  );
}

export function MetaChip({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-2xs">
      <span className="text-faint">{label}:</span>
      <span className={cn('font-medium', empty ? 'text-faint' : 'text-foreground')}>
        {empty ? 'None' : value}
      </span>
    </span>
  );
}

/** Unit adornment for kit quantity inputs: "kit" / "kits", set apart from the number. */
export function KitUnit({ qty }: { readonly qty: number | null | undefined }) {
  return (
    <span className="ml-1.5 rounded border-l border-border px-1.5 text-2xs font-medium text-faint">
      {qty === 1 ? 'kit' : 'kits'}
    </span>
  );
}
