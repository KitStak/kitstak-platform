'use client';
/** Small client pieces shared by the People, Agencies, Import and Settings screens. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, toast, type SelectOption } from '@/components/ui';

/** Radix Select cannot hold an empty value, so "none" stands in for null. */
export const NONE = '__none__';

export function OptionalSelect({
  value,
  onChange,
  options,
  noneLabel = 'None',
  id,
  invalid,
  disabled,
  ariaLabel,
  testId,
}: {
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly options: readonly SelectOption[];
  readonly noneLabel?: string;
  readonly id?: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly testId?: string;
}) {
  return (
    <Select
      id={id}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
      options={[{ value: NONE, label: noneLabel }, ...options]}
      invalid={invalid}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  );
}

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly message: string; readonly fields?: Readonly<Record<string, string>> } };

/**
 * Runs a server action with a pending flag, a toast on failure, and the field messages kept for
 * the form. Refreshes the page after success unless told not to.
 */
export function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  async function run<T>(key: string, action: () => Promise<Result<T>>, options: { readonly success?: string; readonly failure?: string; readonly refresh?: boolean } = {}): Promise<T | null> {
    setPending(key);
    try {
      const result = await action();
      if (!result.ok) {
        setFields(result.error.fields ?? {});
        toast.error(options.failure ?? 'That did not save', result.error.message);
        return null;
      }
      setFields({});
      if (options.success) toast.success(options.success);
      if (options.refresh !== false) router.refresh();
      return result.data;
    } catch {
      toast.error(options.failure ?? 'That did not save', 'Check your connection and try again.');
      return null;
    } finally {
      setPending(null);
    }
  }
  return { run, pending, fields, setFields };
}

export { dollarsToCents, KIND_LABELS, LANGUAGE_LABELS, STATUS_LABELS, STATUS_TONE, WEEKDAYS } from './labels';
