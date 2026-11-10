"use client";

/**
 * Terse wizard field wrappers over `FormField` + the UI primitives, so each step reads as a
 * field list. All of them show the inline error under the control (0.3).
 */
import * as React from "react";
import type { FieldValues, Path } from "react-hook-form";
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
          showCount={showCount ?? Boolean(maxLength)}
          placeholder={placeholder}
          trailing={trailing}
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

export function NumF({ decimals = 0, min = 0, max, suffix, placeholder, onValue, ...base }: Base & { readonly decimals?: number; readonly min?: number; readonly max?: number; readonly suffix?: React.ReactNode; readonly placeholder?: string; readonly onValue?: (v: number | null) => void }) {
  return (
    <FormField<Values> name={base.name as Path<Values>} label={base.label} required={base.required} info={base.info} description={base.description} disabled={base.disabled} className={base.className}>
      {(c) => (
        <NumberInput
          id={c.id}
          name={c.name}
          value={(c.value as number | null) ?? null}
          onChange={(v) => {
            c.onChange(v);
            onValue?.(v);
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          aria-invalid={c["aria-invalid"]}
          aria-describedby={c["aria-describedby"]}
          disabled={c.disabled}
          decimals={decimals}
          min={min}
          max={max}
          suffix={suffix}
          placeholder={placeholder ?? (decimals ? (0).toFixed(decimals) : "0")}
        />
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
        />
      )}
    </FormField>
  );
}

export const opts = (values: readonly string[], labels?: Readonly<Record<string, string>>): SelectOption[] =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? v }));
