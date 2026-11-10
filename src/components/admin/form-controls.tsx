"use client";

/**
 * Typed form controls for the M14 drawers and wizards. Each one wraps the shared
 * `FormField` (label, required *, inline error, focus-first-error) around a ui primitive.
 */
import * as React from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import { FormField } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
const splitCamel = (value: string): string => value.replace(/([a-z])([A-Z])/g, "$1 $2");

interface Base<T extends FieldValues> {
  readonly name: FieldPath<T>;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function TextInput<T extends FieldValues>({ placeholder, maxLength, showCount, transform, ...p }: Base<T> & { readonly placeholder?: string; readonly maxLength?: number; readonly showCount?: boolean; readonly transform?: (v: string) => string }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <TextField
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLInputElement>}
          value={(c.value as string | null) ?? ""}
          onChange={(e) => c.onChange(transform ? transform(e.target.value) : e.target.value)}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-invalid={c["aria-invalid"]}
          aria-describedby={c["aria-describedby"]}
          aria-required={c["aria-required"]}
          placeholder={placeholder}
          maxLength={maxLength}
          showCount={showCount && Boolean(maxLength)}
        />
      )}
    </FormField>
  );
}

export function NumberField<T extends FieldValues>({ min = 0, max, decimals = 0, suffix, nullable, ...p }: Base<T> & { readonly min?: number; readonly max?: number; readonly decimals?: number; readonly suffix?: React.ReactNode; readonly nullable?: boolean }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <NumberInput
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLInputElement>}
          value={(c.value as number | null) ?? null}
          onChange={(v) => c.onChange(v === null && !nullable ? 0 : v)}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-invalid={c["aria-invalid"]}
          aria-describedby={c["aria-describedby"]}
          min={min}
          max={max}
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

export function SelectField<T extends FieldValues>({ options, placeholder, clearable, onValueChange, ...p }: Base<T> & { readonly options: readonly SelectOption[]; readonly placeholder?: string; readonly clearable?: boolean; readonly onValueChange?: (v: string | null) => void }) {
  return (
    <FormField<T> {...p}>
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
          aria-describedby={c["aria-describedby"]}
          options={options}
          placeholder={placeholder ?? "Select"}
          clearable={clearable}
        />
      )}
    </FormField>
  );
}

export function ComboField<T extends FieldValues>({ options, placeholder, onValueChange, emptyText, ...p }: Base<T> & { readonly options: readonly ComboboxOption[]; readonly placeholder?: string; readonly onValueChange?: (v: string | null) => void; readonly emptyText?: string }) {
  return (
    <FormField<T> {...p}>
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
          placeholder={placeholder ?? "Select"}
          clearable
          emptyText={emptyText}
        />
      )}
    </FormField>
  );
}

export function YesNoField<T extends FieldValues>(p: Base<T>) {
  return (
    <FormField<T> {...p}>
      {(c) => <YesNoToggle id={c.id} value={(c.value as boolean | null) ?? false} onChange={c.onChange} disabled={c.disabled} ariaLabel={typeof p.label === "string" ? p.label : undefined} aria-invalid={c["aria-invalid"]} />}
    </FormField>
  );
}

export function CheckboxField<T extends FieldValues>({ hint, ...p }: Base<T> & { readonly hint?: React.ReactNode }) {
  return (
    <FormField<T> name={p.name} disabled={p.disabled} className={p.className}>
      {(c) => <Checkbox id={c.id} checked={Boolean(c.value)} onCheckedChange={(v) => c.onChange(v === true)} disabled={c.disabled} label={p.label} description={hint} />}
    </FormField>
  );
}
