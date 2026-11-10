"use client";

/**
 * Terse field wrappers for the order wizard: `FormField` + a UI primitive, so each step
 * reads as a field list. Every wrapper shows the inline error under its control (0.3).
 */
import * as React from "react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";
import { FieldLabel, FormField } from "@/components/ui/form";
import { Combobox, type ComboboxOption, type LoadOptions } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { ChipInput } from "@/components/ui/chip-input";

type V = FieldValues;

export interface FieldBase {
  readonly name: string;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

const p = (name: string) => name as Path<V>;

export function TextF({ maxLength, placeholder, trailing, onValue, readOnly, hideCount, ...b }: FieldBase & { readonly hideCount?: boolean; readonly maxLength?: number; readonly placeholder?: string; readonly trailing?: React.ReactNode; readonly onValue?: (v: string) => void; readonly readOnly?: boolean }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <TextField
          {...c}
          value={(c.value as string | null) ?? ""}
          onChange={(e) => {
            c.onChange(e);
            onValue?.((e as unknown as React.ChangeEvent<HTMLInputElement>).target.value);
          }}
          maxLength={maxLength}
          showCount={Boolean(maxLength) && !readOnly && !hideCount}
          placeholder={placeholder}
          trailing={trailing}
          readOnly={readOnly}
        />
      )}
    </FormField>
  );
}

export function AreaF({ maxLength, placeholder, rows = 3, ...b }: FieldBase & { readonly maxLength?: number; readonly placeholder?: string; readonly rows?: number }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} disabled={b.disabled} className={b.className}>
      {(c) => <Textarea {...c} value={(c.value as string | null) ?? ""} maxLength={maxLength} rows={rows} placeholder={placeholder} />}
    </FormField>
  );
}

export function NumF({ decimals = 0, min = 0, max, suffix, placeholder, hideStepper, ...b }: FieldBase & { readonly decimals?: number; readonly min?: number; readonly max?: number; readonly suffix?: React.ReactNode; readonly placeholder?: string; readonly hideStepper?: boolean }) {
  const form = useFormContext<V>();
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <NumberInput
          id={c.id}
          ref={c.ref as React.Ref<HTMLInputElement>}
          value={(c.value as number | null) ?? null}
          onChange={(v) => {
            c.onChange(v);
            // Out-of-range entry shows its inline error while typing (the input clamps on blur).
            // (The wizard validates per step on Next, so the range error is set here directly.)
            const label = typeof b.label === "string" ? b.label : "Value";
            if (v !== null && min !== undefined && v < min) {
              form.setError(p(b.name), { type: "range", message: min === 0 ? `${label} can't be negative` : `${label} must be at least ${min}` });
            } else if (v !== null && max !== undefined && v > max) {
              form.setError(p(b.name), { type: "range", message: `${label} can be at most ${max}` });
            } else if (form.getFieldState(p(b.name)).error?.type === "range") {
              form.clearErrors(p(b.name));
            }
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={c.disabled}
          aria-describedby={c["aria-describedby"]}
          aria-invalid={c["aria-invalid"]}
          decimals={decimals}
          min={min}
          max={max}
          suffix={suffix}
          placeholder={placeholder}
          hideStepper={hideStepper}
        />
      )}
    </FormField>
  );
}

export function SelectF({ options, placeholder, clearable, onValue, ...b }: FieldBase & { readonly options: readonly SelectOption[]; readonly placeholder?: string; readonly clearable?: boolean; readonly onValue?: (v: string | null) => void }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <Select
          id={c.id}
          aria-label={typeof b.label === "string" ? b.label : undefined}
          aria-describedby={c["aria-describedby"]}
          options={options}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v);
            onValue?.(v);
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={c.disabled}
          clearable={clearable}
          placeholder={placeholder ?? "Select"}
        />
      )}
    </FormField>
  );
}

export function ComboF({ options, loadOptions, selectedOptions, minChars, placeholder, emptyText, clearable, onValue, ...b }: FieldBase & {
  readonly options?: readonly ComboboxOption[]; readonly loadOptions?: LoadOptions; readonly selectedOptions?: readonly ComboboxOption[]; readonly minChars?: number;
  readonly placeholder?: string; readonly emptyText?: string; readonly clearable?: boolean; readonly onValue?: (v: string | null, option: ComboboxOption | null) => void;
}) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <Combobox
          id={c.id}
          aria-label={typeof b.label === "string" ? b.label : undefined}
          aria-describedby={c["aria-describedby"]}
          options={options}
          loadOptions={loadOptions}
          selectedOptions={selectedOptions}
          minChars={minChars}
          value={(c.value as string | null) || null}
          onChange={(v, option) => {
            c.onChange(v ?? (b.name.endsWith("Id") ? null : ""));
            onValue?.(v, option);
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={c.disabled}
          clearable={clearable}
          placeholder={placeholder ?? "Select"}
          emptyText={emptyText}
        />
      )}
    </FormField>
  );
}

export function DateTimeF({ placeholder, ...b }: FieldBase & { readonly placeholder?: string }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <DateTimePicker
          id={c.id}
          aria-label={typeof b.label === "string" ? b.label : undefined}
          aria-describedby={c["aria-describedby"]}
          value={c.value ? new Date(c.value as string) : null}
          onChange={(d) => c.onChange(d ? d.toISOString() : null)}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={c.disabled}
          clearable={!b.required}
          placeholder={placeholder ?? "YYYY/MM/DD HH:mm"}
        />
      )}
    </FormField>
  );
}

export function YesNoF({ onValue, ...b }: FieldBase & { readonly onValue?: (v: boolean) => void }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <YesNoToggle
          id={c.id}
          value={Boolean(c.value)}
          onChange={(v) => {
            c.onChange(v);
            onValue?.(v);
          }}
          disabled={c.disabled}
          ariaLabel={typeof b.label === "string" ? b.label : undefined}
        />
      )}
    </FormField>
  );
}

export function ChipsF({ placeholder, maxItems = 50, ...b }: FieldBase & { readonly placeholder?: string; readonly maxItems?: number }) {
  return (
    <FormField<V> name={p(b.name)} label={b.label} required={b.required} info={b.info} description={b.description} disabled={b.disabled} className={b.className}>
      {(c) => (
        <ChipInput
          id={c.id}
          aria-label={typeof b.label === "string" ? b.label : undefined}
          aria-describedby={c["aria-describedby"]}
          value={(c.value as string[] | null) ?? []}
          onChange={(v) => c.onChange([...v])}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={c.disabled}
          maxItems={maxItems}
          maxLength={100}
          placeholder={placeholder ?? "Enter and add tracking number"}
        />
      )}
    </FormField>
  );
}

/** A form-aligned read-only value (Logiwa shows locked header fields as plain text, not disabled dropdowns). */
export function StaticF({ label, value, info, description }: { readonly label: React.ReactNode; readonly value: React.ReactNode; readonly info?: React.ReactNode; readonly description?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel info={info}>{label}</FieldLabel>
      <span className="flex h-8 min-w-0 items-center truncate text-[13px] font-medium text-foreground" title={typeof value === "string" ? value : undefined}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
      {description ? <p className="text-[11px] text-faint">{description}</p> : null}
    </div>
  );
}

/** Read-only label/value pair used on the Confirm step and in drawers. */
export function ReadValue({ label, children }: { readonly label: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{label}</span>
      <span className="truncate text-[13px] text-foreground">{children === null || children === undefined || children === "" ? "—" : children}</span>
    </div>
  );
}
