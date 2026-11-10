"use client";

/** Typed form controls for the Shipment Plan drawer, each wrapping the shared FormField. */
import * as React from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import { FormField } from "@/components/ui/form";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";

interface Base<T extends FieldValues> {
  readonly name: FieldPath<T>;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function TextInput<T extends FieldValues>({ placeholder, maxLength, ...p }: Base<T> & { readonly placeholder?: string; readonly maxLength?: number }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <TextField id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur}
          disabled={c.disabled} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} aria-required={c["aria-required"]} placeholder={placeholder} maxLength={maxLength} />
      )}
    </FormField>
  );
}

export function NoteInput<T extends FieldValues>({ maxLength, ...p }: Base<T> & { readonly maxLength?: number }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <Textarea id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLTextAreaElement>} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur}
          disabled={c.disabled} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} maxLength={maxLength} rows={3} />
      )}
    </FormField>
  );
}

export function NumberField<T extends FieldValues>({ decimals = 0, suffix, ...p }: Base<T> & { readonly decimals?: number; readonly suffix?: React.ReactNode }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <NumberInput id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} value={(c.value as number | null) ?? null} onChange={(v) => c.onChange(v ?? 0)} onBlur={c.onBlur}
          disabled={c.disabled} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} min={0} max={1_000_000} decimals={decimals} suffix={suffix} />
      )}
    </FormField>
  );
}

export function SelectField<T extends FieldValues>({ options, placeholder, clearable, ...p }: Base<T> & { readonly options: readonly SelectOption[]; readonly placeholder?: string; readonly clearable?: boolean }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <Select id={c.id} name={c.name} value={(c.value as string | null) || null} onChange={(v) => c.onChange(v ?? null)} onBlur={c.onBlur} disabled={c.disabled} invalid={c.invalid}
          aria-describedby={c["aria-describedby"]} options={options} placeholder={placeholder ?? "Select"} clearable={clearable} />
      )}
    </FormField>
  );
}

export function ComboField<T extends FieldValues>({ options, placeholder, emptyText, onValueChange, ...p }: Base<T> & { readonly options: readonly ComboboxOption[]; readonly placeholder?: string; readonly emptyText?: string; readonly onValueChange?: (v: string | null) => void }) {
  return (
    <FormField<T> {...p}>
      {(c) => (
        <Combobox id={c.id} options={options} value={(c.value as string | null) || null} onChange={(v) => { c.onChange(v ?? null); onValueChange?.(v ?? null); }} onBlur={c.onBlur} disabled={c.disabled} invalid={c.invalid}
          placeholder={placeholder ?? "Select"} clearable emptyText={emptyText} />
      )}
    </FormField>
  );
}

export function DateTimeField<T extends FieldValues>(p: Base<T>) {
  return (
    <FormField<T> {...p}>
      {(c) => {
        const iso = c.value as string | null;
        return (
          <DateTimePicker id={c.id} value={iso ? new Date(iso) : null} onChange={(d) => c.onChange(d ? d.toISOString() : null)} onBlur={c.onBlur} disabled={c.disabled} invalid={c.invalid}
            aria-describedby={c["aria-describedby"]} clearable />
        );
      }}
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

/** Wraps a custom control (async picker) in a FormField with the standard wiring. */
export function CustomField<T extends FieldValues>({ children, ...p }: Base<T> & { readonly children: (c: { id: string; value: string | null; onChange: (v: string | null) => void; onBlur: () => void; invalid: boolean; disabled?: boolean }) => React.ReactNode }) {
  return (
    <FormField<T> {...p}>
      {(c) => children({ id: c.id, value: (c.value as string | null) || null, onChange: (v) => c.onChange(v), onBlur: c.onBlur, invalid: c.invalid, disabled: c.disabled })}
    </FormField>
  );
}
