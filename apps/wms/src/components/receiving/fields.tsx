"use client";

/**
 * Terse form-field wrappers for the M05 forms (PO wizard, line editor, receive drawer,
 * vendor drawer). Each one is a `FormField` with the inline error under the control.
 * Dates are stored as ISO strings in the form and edited through the Date pickers.
 */
import * as React from "react";
import type { FieldValues, Path } from "react-hook-form";
import { countryOptions, subdivisionsFor } from "@/lib/countries";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { FormField } from "@/components/ui/form";
import { parseInputDateTime } from "@/lib/format";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";

interface Base {
  readonly name: string;
  readonly label: React.ReactNode;
  readonly required?: boolean;
  readonly info?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

const field = (b: Base) => ({ name: b.name as Path<FieldValues>, label: b.label, required: b.required, info: b.info, description: b.description, disabled: b.disabled, className: b.className });

export function TextF({ maxLength, hideCount, placeholder, trailing, onBlurExtra, onValue, autoFocus, ...base }: Base & { readonly maxLength?: number; /** Keep the max length but hide the counter so the error sits right under the input. */ readonly hideCount?: boolean; readonly placeholder?: string; readonly trailing?: React.ReactNode; readonly onBlurExtra?: (value: string) => void; readonly onValue?: (value: string) => void; readonly autoFocus?: boolean }) {
  return (
    <FormField<FieldValues> {...field(base)}>
      {(c) => (
        <TextField
          {...c}
          value={(c.value as string | null) ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            c.onChange(e.target.value);
            onValue?.(e.target.value);
          }}
          onBlur={() => {
            c.onBlur();
            onBlurExtra?.(String(c.value ?? ""));
          }}
          maxLength={maxLength}
          showCount={Boolean(maxLength) && !hideCount}
          placeholder={placeholder}
          trailing={trailing}
          autoFocus={autoFocus}
        />
      )}
    </FormField>
  );
}

export function AreaF({ maxLength, placeholder, rows = 3, ...base }: Base & { readonly maxLength?: number; readonly placeholder?: string; readonly rows?: number }) {
  return (
    <FormField<FieldValues> {...field(base)}>
      {(c) => <Textarea {...c} value={(c.value as string | null) ?? ""} maxLength={maxLength} rows={rows} placeholder={placeholder} showCount={Boolean(maxLength)} />}
    </FormField>
  );
}

export function NumF({ decimals = 0, min = 0, max, suffix, placeholder, onValue, ...base }: Base & { readonly decimals?: number; readonly min?: number; readonly max?: number; readonly suffix?: React.ReactNode; readonly placeholder?: string; readonly onValue?: (v: number | null) => void }) {
  return (
    <FormField<FieldValues> {...field(base)}>
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
    <FormField<FieldValues> {...field(base)}>
      {(c) => (
        <Select
          id={c.id}
          name={c.name}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v ?? "");
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

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const toDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  // "2027-05-08" is a calendar day: show it as that local day (new Date() would read UTC midnight).
  const day = DAY_RE.exec(v);
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Local calendar day of a picked date as YYYY-MM-DD (date-only attributes never carry a time). */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Date-time field (ISO instant) or, without `withTime`, a date-only field (YYYY-MM-DD). */
export function DateF({ withTime = false, placeholder, liveValidate = false, ...base }: Base & {
  readonly withTime?: boolean;
  readonly placeholder?: string;
  /**
   * Date-only fields: the form value always mirrors the typed text. Valid text is committed as
   * YYYY-MM-DD while typing; unparseable text ("2027/06/304") is stored as typed, so the form
   * schema rejects it and a submit can never post a different date than the one on screen.
   */
  readonly liveValidate?: boolean;
}) {
  const Picker = withTime ? DateTimePicker : DatePicker;
  return (
    <FormField<FieldValues> {...field(base)}>
      {(c) => (
        <DateInputMirror enabled={liveValidate && !withTime} value={c.value} onText={(next) => c.onChange(next)}>
        <Picker
          id={c.id}
          value={toDate(c.value)}
          onChange={(d) => c.onChange(d ? (withTime ? d.toISOString() : localDay(d)) : null)}
          onBlur={c.onBlur}
          invalid={c.invalid}
          aria-describedby={c["aria-describedby"]}
          disabled={c.disabled}
          placeholder={placeholder ?? (withTime ? "Enter date/time" : "Enter date")}
          clearable={!base.required}
        />
        </DateInputMirror>
      )}
    </FormField>
  );
}

/** Text typed into a date-only picker → the form value (see `DateF.liveValidate`). */
export function dateTextValue(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const d = parseInputDateTime(t);
  return d && !/[ T]\d/.test(t) ? localDay(d) : t;
}

function DateInputMirror({ enabled, value, onText, children }: { readonly enabled: boolean; readonly value: unknown; readonly onText: (value: string | null) => void; readonly children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <div
      className="contents"
      onInput={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName !== "INPUT") return;
        const next = dateTextValue(target.value);
        if (next !== value) onText(next);
      }}
    >
      {children}
    </div>
  );
}

const COUNTRY_OPTIONS = countryOptions();

/** Country combobox; `stateName` is reset when the country changes. */
export function CountryF({ stateName, onCountry, ...base }: Base & { readonly stateName?: string; readonly onCountry?: (code: string | null) => void }) {
  void stateName;
  return (
    <FormField<FieldValues> {...field(base)}>
      {(c) => (
        <Combobox
          id={c.id}
          options={COUNTRY_OPTIONS}
          value={(c.value as string | null) || null}
          onChange={(v) => {
            c.onChange(v ?? "");
            onCountry?.(v);
          }}
          onBlur={c.onBlur}
          invalid={c.invalid}
          aria-describedby={c["aria-describedby"]}
          disabled={c.disabled}
          placeholder="Select country"
        />
      )}
    </FormField>
  );
}

/** State / province: a select for countries with subdivisions, text otherwise. */
export function StateF({ country, ...base }: Base & { readonly country: string | null | undefined }) {
  const subdivisions = subdivisionsFor(country);
  if (subdivisions.length === 0) return <TextF {...base} maxLength={100} />;
  return <SelectF {...base} options={subdivisions.map((s) => ({ value: s.code, label: s.name }))} placeholder={country === "CA" ? "Select province" : "Select state"} />;
}

export const optionsOf = (values: readonly string[]): SelectOption[] => values.map((v) => ({ value: v, label: v }));
