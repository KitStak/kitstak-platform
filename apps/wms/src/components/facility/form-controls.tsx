'use client';

/**
 * Terse, typed form controls for the M10 drawers and wizards. Each one wraps the shared
 * `FormField` (label, required *, inline error, focus-first-error) around a ui primitive.
 */
import * as React from 'react';
import {
  get,
  useFormContext,
  useFormState,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { cn } from '@/lib/utils';
import { FormField } from '@/components/ui/form';
import { NumberInput } from '@/components/ui/number-input';
import { Select, type SelectOption } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { splitCamel } from '@/lib/grid-defs/facility/common';

/**
 * Focus is info-blue, never brand red: red is reserved for aria-invalid (critic R2). The shared
 * control styles already use info for focus; this also covers an open Select trigger and native
 * inputs that still carry `focus:border-primary`. Higher specificity than the primitives' own
 * utilities, and skipped for invalid controls so their red error border wins.
 */
export const FOCUS_NEUTRAL = [
  '[&_:is(input,textarea,select,[role=combobox]):focus:not([aria-invalid=true])]:border-info',
  '[&_:is(input,textarea,select,[role=combobox]):focus:not([aria-invalid=true])]:ring-info/25',
  '[&_[role=combobox][data-state=open]:not([aria-invalid=true])]:border-info',
  '[&_[role=combobox][data-state=open]:not([aria-invalid=true])]:ring-info/25',
].join(' ');

interface Base<T extends FieldValues> {
  readonly name: FieldPath<T>;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function TextInput<T extends FieldValues>({
  placeholder,
  maxLength,
  showCount,
  transform,
  ...p
}: Base<T> & {
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly showCount?: boolean;
  readonly transform?: (v: string) => string;
}) {
  return (
    <FormField<T> {...p} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <TextField
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLInputElement>}
          value={(c.value as string | null) ?? ''}
          onChange={(e) => c.onChange(transform ? transform(e.target.value) : e.target.value)}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-invalid={c['aria-invalid']}
          aria-describedby={c['aria-describedby']}
          aria-required={c['aria-required']}
          placeholder={placeholder}
          maxLength={maxLength}
          showCount={showCount && Boolean(maxLength)}
        />
      )}
    </FormField>
  );
}

/** Inline message for a value outside [min, max], or null. Pure; exported for tests. */
export function rangeMessage(
  value: number | null | undefined,
  min: number | undefined,
  max: number | undefined,
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (min !== undefined && value < min)
    return min === 0 ? "Can't be negative" : `Must be at least ${min.toLocaleString('en-US')}`;
  if (max !== undefined && value > max) return `Must be at most ${max.toLocaleString('en-US')}`;
  return null;
}

/**
 * Number input that never silently clamps (critic R1: -5 quietly became 0, a count of 0
 * quietly became 1). Out-of-range values stay as typed and get an inline error at once;
 * the step schema enforces the same bounds, so Next stays blocked until they are fixed.
 */
export function NumberField<T extends FieldValues>({
  min = 0,
  max,
  decimals = 0,
  suffix,
  nullable,
  ...p
}: Base<T> & {
  readonly min?: number;
  readonly max?: number;
  readonly decimals?: number;
  readonly suffix?: React.ReactNode;
  readonly nullable?: boolean;
}) {
  const form = useFormContext<T>();
  return (
    <FormField<T> {...p} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <NumberInput
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLInputElement>}
          value={(c.value as number | null) ?? null}
          onChange={(v) => {
            const next = v === null && !nullable ? 0 : v;
            c.onChange(next);
            // After RHF's own (async) re-validation of the change, which would clear a sync setError.
            setTimeout(() => {
              const message = rangeMessage(next, min, max);
              const current = form.getFieldState(p.name).error;
              if (message) form.setError(p.name, { type: 'range', message });
              else if (current?.type === 'range') form.clearErrors(p.name);
            }, 0);
          }}
          onBlur={() => {
            c.onBlur();
            setTimeout(() => {
              const message = rangeMessage(form.getValues(p.name) as number | null, min, max);
              if (message) form.setError(p.name, { type: 'range', message });
            }, 0);
          }}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-invalid={c['aria-invalid']}
          aria-describedby={c['aria-describedby']}
          aria-valuemin={min}
          aria-valuemax={max}
          decimals={decimals}
          suffix={suffix}
        />
      )}
    </FormField>
  );
}

/** Options from a const enum, with "BusinessStation" shown as "Business Station". */
export function enumSelectOptions(values: readonly string[]): readonly SelectOption[] {
  return values.map((value) => ({ value, label: splitCamel(value) }));
}

export function SelectField<T extends FieldValues>({
  options,
  placeholder,
  clearable,
  onValueChange,
  ...p
}: Base<T> & {
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly clearable?: boolean;
  readonly onValueChange?: (v: string | null) => void;
}) {
  return (
    <FormField<T> {...p} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <Select
          id={c.id}
          name={c.name}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v ?? null);
            onValueChange?.(v);
          }}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-describedby={c['aria-describedby']}
          options={options}
          placeholder={placeholder ?? 'Select'}
          clearable={clearable}
        />
      )}
    </FormField>
  );
}

export function ComboField<T extends FieldValues>({
  options,
  placeholder,
  onValueChange,
  emptyText,
  ...p
}: Base<T> & {
  readonly options: readonly ComboboxOption[];
  readonly placeholder?: string;
  readonly onValueChange?: (v: string | null) => void;
  readonly emptyText?: string;
}) {
  return (
    <FormField<T> {...p} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <Combobox
          id={c.id}
          options={options}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v ?? null);
            onValueChange?.(v);
          }}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          placeholder={placeholder ?? 'Select'}
          clearable
          emptyText={emptyText}
        />
      )}
    </FormField>
  );
}

/**
 * Yes / No pair sized to its content. Settings are neutral, so a selected "No" is a calm
 * neutral fill rather than the shared danger red (critic R1: "No" read as an error).
 */
const NEUTRAL_NO =
  '[&>button:last-child[data-state=on]]:bg-neutral [&>button:last-child[data-state=on]]:text-white';

export function YesNoField<T extends FieldValues>(p: Base<T>) {
  return (
    <FormField<T> {...p} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <div className="flex">
          <YesNoToggle
            id={c.id}
            value={(c.value as boolean | null) ?? false}
            onChange={c.onChange}
            disabled={c.disabled}
            ariaLabel={typeof p.label === 'string' ? p.label : undefined}
            aria-invalid={c['aria-invalid']}
            className={cn('w-auto shrink-0', NEUTRAL_NO)}
          />
        </div>
      )}
    </FormField>
  );
}

export function CheckboxField<T extends FieldValues>({
  hint,
  ...p
}: Base<T> & { readonly hint?: React.ReactNode }) {
  return (
    <FormField<T> name={p.name} disabled={p.disabled} className={cn(FOCUS_NEUTRAL, p.className)}>
      {(c) => (
        <Checkbox
          id={c.id}
          checked={Boolean(c.value)}
          onCheckedChange={(v) => c.onChange(v === true)}
          disabled={c.disabled}
          label={p.label}
          description={hint}
        />
      )}
    </FormField>
  );
}

/**
 * Shows a cross-field error on `name` as soon as the rule fails, and clears it once it passes
 * (only clears errors it set itself). Deferred past RHF's own async re-validation of the change.
 */
export function useCrossFieldError<T extends FieldValues>(
  form: UseFormReturn<T>,
  name: FieldPath<T>,
  message: string | null,
): void {
  // RHF's blur / change re-validation of a field without rules clears any manual error on it, and
  // nothing re-applied ours afterwards (critic R4: Empty 10 / Max 5 blocked Next with no message).
  // Watching the field's error re-asserts the message whenever something else wipes it.
  const { errors } = useFormState({ control: form.control, name });
  const present = Boolean(get(errors, name));
  React.useEffect(() => {
    const t = setTimeout(() => {
      const current = form.getFieldState(name).error;
      if (message) {
        if (!current || current.type === 'cross' || current.message === message) {
          if (current?.message !== message || current.type !== 'cross')
            form.setError(name, { type: 'cross', message });
        }
      } else if (current?.type === 'cross') form.clearErrors(name);
    }, 0);
    return () => clearTimeout(t);
  }, [form, name, message, present]);
}
