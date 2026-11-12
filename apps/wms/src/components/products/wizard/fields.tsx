"use client";

/**
 * Terse wizard field wrappers over `FormField` + the UI primitives, so each step reads as a
 * field list. All of them show the inline error under the control (0.3).
 */
import * as React from "react";
import { useWatch, type FieldValues, type Path } from "react-hook-form";
import { FormField } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";

type Values = FieldValues;

interface Base {
  readonly name: string;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function TextF({ maxLength, placeholder, showCount, trailing, onBlurExtra, ...base }: Base & { readonly maxLength?: number; readonly placeholder?: string; readonly showCount?: boolean; readonly trailing?: React.ReactNode; readonly onBlurExtra?: (value: string) => void }) {
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} required={base.required} info={base.info} description={base.description} disabled={base.disabled} className={base.className}>
      {(c) => (
        <TextField
          {...c}
          value={(c.value as string | null) ?? ""}
          onBlur={() => {
            c.onBlur();
            onBlurExtra?.(String(c.value ?? ""));
          }}
          maxLength={maxLength}
          // The counter sits inside the input (trailing) so a field error renders directly
          // under the input instead of below a separate counter row (REQ-8 workaround).
          showCount={false}
          placeholder={placeholder}
          trailing={trailing ?? ((showCount ?? Boolean(maxLength)) && maxLength ? <span className="tabular-nums text-2xs text-faint" aria-hidden>{String(c.value ?? "").length}/{maxLength}</span> : undefined)}
        />
      )}
    </FormField>
  );
}

export function AreaF({ maxLength, placeholder, rows = 3, ...base }: Base & { readonly maxLength?: number; readonly placeholder?: string; readonly rows?: number }) {
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} required={base.required} info={base.info} disabled={base.disabled} className={base.className}>
      {(c) => <Textarea {...c} value={(c.value as string | null) ?? ""} maxLength={maxLength} rows={rows} placeholder={placeholder} showCount={Boolean(maxLength)} />}
    </FormField>
  );
}

export function NumF({ decimals = 0, min = 0, max, suffix, placeholder, onValue, rangeText, unclamped: _unclamped, ...base }: Base & { readonly unclamped?: boolean; readonly rangeText?: string; readonly decimals?: number; readonly min?: number; readonly max?: number; readonly suffix?: React.ReactNode; readonly placeholder?: string; readonly onValue?: (v: number | null) => void }) {
  // Bounds are NOT passed to NumberInput (it would silently clamp -5 to 0). The value is kept as
  // typed; a range message shows inline as soon as it is committed, and the step schema blocks
  // Next with the same message. Kept in local state because RHF's blur re-validation (no
  // resolver) would clear a manually set field error.
  const rangeMessage = (v: number | null): string | null =>
    v === null ? null : v < min ? rangeText ?? `Must be ${min} or more` : max !== undefined && v > max ? rangeText ?? `Must be ${max} or less` : null;
  const watched = useWatch({ name: base.name }) as number | null | undefined;
  const live = rangeMessage(typeof watched === "number" ? watched : null);
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} required={base.required} info={base.info} description={base.description} disabled={base.disabled} className={base.className}>
      {(c, fieldState) => (
        <>
          <NumberInput
            id={c.id}
            name={c.name}
            value={(c.value as number | null) ?? null}
            onChange={(v) => {
              c.onChange(v);
              onValue?.(v);
            }}
            onBlur={c.onBlur}
            invalid={c.invalid || Boolean(live)}
            aria-invalid={c["aria-invalid"] ?? (live ? true : undefined)}
            aria-describedby={c["aria-describedby"]}
            disabled={c.disabled}
            decimals={decimals}
            suffix={suffix}
            placeholder={placeholder ?? (decimals ? (0).toFixed(decimals) : "0")}
          />
          {live && !fieldState.error ? <p role="alert" className="text-xs text-danger">{live}</p> : null}
        </>
      )}
    </FormField>
  );
}

export function SelectF({ options, placeholder = "Select an option", clearable, onValue, ...base }: Base & { readonly options: readonly SelectOption[]; readonly placeholder?: string; readonly clearable?: boolean; readonly onValue?: (v: string | null) => void }) {
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} required={base.required} info={base.info} description={base.description} disabled={base.disabled} className={base.className}>
      {(c) => (
        <Select
          id={c.id}
          name={c.name}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v);
            onValue?.(v);
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          aria-describedby={c["aria-describedby"]}
          disabled={c.disabled}
          options={options}
          placeholder={placeholder}
          clearable={clearable}
        />
      )}
    </FormField>
  );
}

export function YesNoF({ onValue, ...base }: Base & { readonly onValue?: (v: boolean) => void }) {
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} info={base.info} disabled={base.disabled} className={base.className}>
      {(c) => (
        <YesNoToggle
          id={c.id}
          value={(c.value as boolean | null) ?? false}
          onChange={(v) => {
            c.onChange(v);
            onValue?.(v);
          }}
          disabled={c.disabled}
          ariaLabel={typeof base.label === "string" ? base.label : undefined}
          className={NEUTRAL_NO}
        />
      )}
    </FormField>
  );
}

/**
 * The shared toggle paints a selected "No" solid red; for neutral defaults (handling flags,
 * Active?/Digital?) "No" reads as a quiet grey selection and red stays reserved for errors
 * (shared change filed as REQ-15).
 */
export const NEUTRAL_NO = "w-fit [&>[data-state=on]:last-child]:bg-neutral-soft [&>[data-state=on]:last-child]:text-body";

/** Left-aligned "label · toggle" row for flag lists (Packing handling flags). */
export function FlagRow({ name, label, info }: { readonly name: string; readonly label: string; readonly info?: React.ReactNode }) {
  return (
    <FormField<Values> name={name as Path<Values>} label={label} info={info} inline className="rounded-md border border-border px-3 py-2">
      {(c) => (
        <YesNoToggle
          id={c.id}
          value={(c.value as boolean | null) ?? false}
          onChange={(v) => c.onChange(v)}
          disabled={c.disabled}
          ariaLabel={label}
          className={`${NEUTRAL_NO} shrink-0`}
        />
      )}
    </FormField>
  );
}

export const opts = (values: readonly string[], labels?: Readonly<Record<string, string>>): SelectOption[] =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? v }));
