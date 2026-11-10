"use client";

/**
 * Preferences: timezone (read-only, from the warehouse), date, time and number formats.
 * Saving PATCHes /api/me and invalidates the `me` query, so the shell's FormatProvider
 * re-renders every grid date, quantity and amount immediately.
 */
import * as React from "react";
import { useWatch } from "react-hook-form";
import { Globe2 } from "lucide-react";
import { ME_QUERY_KEY } from "@/lib/permissions-client";
import { useApiMutation } from "@/lib/query-client";
import { formatDate, formatGridDateTime, formatNumber, formatTime } from "@/lib/format";
import { preferencesFormSchema, type PreferencesFormValues } from "@/components/layout/account/account-options";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { RadioCards } from "@/components/ui/radio-cards";
import { Select } from "@/components/ui/select";

/** Logiwa offers dd/MM/yyyy, MM/dd/yyyy, yyyy/MM/dd; we keep KitStaks' M/D/YYYY default too. */
export const DATE_PATTERNS = [
  { value: "M/D/YYYY h:mm:ss A", label: "M/D/YYYY (default)" },
  { value: "MM/DD/YYYY h:mm:ss A", label: "MM/dd/yyyy" },
  { value: "DD/MM/YYYY h:mm:ss A", label: "dd/MM/yyyy" },
  { value: "YYYY/MM/DD h:mm:ss A", label: "yyyy/MM/dd" },
  { value: "YYYY-MM-DD h:mm:ss A", label: "yyyy-MM-dd (ISO)" },
  { value: "D MMM YYYY h:mm:ss A", label: "d MMM yyyy" },
] as const;

const SAMPLE = new Date(2026, 10, 5, 16, 5, 9);

function optionsFor(current: string) {
  return DATE_PATTERNS.some((o) => o.value === current) ? DATE_PATTERNS : [...DATE_PATTERNS, { value: current, label: `${current} (custom)` }];
}

function Preview({ values }: { readonly values: PreferencesFormValues }) {
  const prefs = { dateFormat: values.dateFormat, timeFormat: values.timeFormat, numberFormat: values.numberFormat };
  const rows: readonly [string, string][] = [
    ["Grid date", formatGridDateTime(SAMPLE, prefs)],
    ["Date", formatDate(SAMPLE, prefs)],
    ["Time", formatTime(SAMPLE, prefs)],
    ["Quantity", formatNumber(10250, 0, prefs)],
    ["Amount", `${formatNumber(1025, 2, prefs)} USD`],
  ];
  return (
    <div aria-live="polite" className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Live preview</p>
      <dl className="mt-1.5 grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt className="text-secondary">{k}</dt><dd className="tabular-nums text-foreground">{v}</dd></React.Fragment>
        ))}
      </dl>
    </div>
  );
}

export function AccountPreferencesForm({ initial, timezone, warehouse }: { readonly initial: PreferencesFormValues; readonly timezone: string; readonly warehouse: string | null }) {
  const form = useZodForm(preferencesFormSchema, initial);
  const watched = useWatch({ control: form.control });
  const values: PreferencesFormValues = { dateFormat: watched.dateFormat ?? initial.dateFormat, timeFormat: watched.timeFormat ?? initial.timeFormat, numberFormat: watched.numberFormat ?? initial.numberFormat };
  const mutation = useApiMutation<PreferencesFormValues, unknown, PreferencesFormValues>({
    path: "/api/me",
    method: "PATCH",
    body: (vars) => ({ preferences: vars }),
    invalidate: [ME_QUERY_KEY],
    form,
    successTitle: "Preferences applied",
    successMessage: "Every grid and summary now uses your formats.",
    onSuccess: (_d, vars) => form.reset(vars),
  });
  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex flex-col gap-4" guardUnsaved>
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-body">Time zone</span>
        <p className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[13px] text-foreground">
          <Globe2 className="h-3.5 w-3.5 text-faint" aria-hidden />{timezone}
        </p>
        <span className="text-[11.5px] text-faint">Set by {warehouse ?? "your warehouse"}. Ask an administrator to change it.</span>
      </div>
      <FormField<PreferencesFormValues> name="dateFormat" label="Date format" required>
        {(c) => <Select id={c.id} value={c.value ?? null} onChange={(v) => c.onChange(v ?? initial.dateFormat)} onBlur={c.onBlur} invalid={c.invalid} aria-describedby={c["aria-describedby"]} options={optionsFor(c.value ?? initial.dateFormat)} />}
      </FormField>
      <FormField<PreferencesFormValues> name="timeFormat" label="Time format" required>
        {(c) => (
          <RadioCards<"12h" | "24h"> ariaLabel="Time format" columns={2} value={(c.value as "12h" | "24h" | null) ?? "12h"} onChange={(v) => c.onChange(v)}
            options={[{ value: "12h", title: "12 hour", description: "4:05 PM" }, { value: "24h", title: "24 hour", description: "16:05" }]} />
        )}
      </FormField>
      <FormField<PreferencesFormValues> name="numberFormat" label="Number format" required>
        {(c) => (
          <RadioCards<"1,025.00" | "1.025,00"> ariaLabel="Number format" columns={2} value={(c.value as "1,025.00" | "1.025,00" | null) ?? "1,025.00"} onChange={(v) => c.onChange(v)}
            options={[{ value: "1,025.00", title: "Thousand separator", description: "1,025.00" }, { value: "1.025,00", title: "Decimal separator", description: "1.025,00" }]} />
        )}
      </FormField>
      <Preview values={values} />
      <SubmitBar submitLabel="Save and apply changes" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} pending={mutation.isPending} />
    </Form>
  );
}
