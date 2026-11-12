"use client";

import { useWatch } from "react-hook-form";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { ME_QUERY_KEY } from "@/lib/permissions-client";
import { useApiMutation } from "@/lib/query-client";
import {
  dateFormatOptions, NUMBER_FORMAT_OPTIONS, preferencesFormSchema, preferencesPreview, TIME_FORMAT_OPTIONS, type PreferencesFormValues,
} from "./account-options";

/** Fixed wall-clock sample (local constructor), so server and browser render the same text. */
const SAMPLE_AT = new Date(2026, 10, 5, 16, 5, 9);

function Preview({ values }: { readonly values: PreferencesFormValues }) {
  const sample = preferencesPreview(values, SAMPLE_AT);
  return (
    <div aria-live="polite" className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
      <p className="text-2xs font-bold text-faint">Preview</p>
      <dl className="mt-1.5 grid grid-cols-[110px_1fr] gap-y-1 text-sm">
        <dt className="text-secondary">Date and time</dt>
        <dd className="tabular-nums text-foreground">{sample.dateTime}</dd>
        <dt className="text-secondary">Number</dt>
        <dd className="tabular-nums text-foreground">{sample.number}</dd>
      </dl>
    </div>
  );
}

/** Date / time / number formats used by every grid and summary (PATCH /api/me). */
export function PreferencesForm({ initial }: { readonly initial: PreferencesFormValues }) {
  const form = useZodForm(preferencesFormSchema, initial);
  const watched = useWatch({ control: form.control });
  const values: PreferencesFormValues = {
    dateFormat: watched.dateFormat ?? initial.dateFormat,
    timeFormat: watched.timeFormat ?? initial.timeFormat,
    numberFormat: watched.numberFormat ?? initial.numberFormat,
  };
  const mutation = useApiMutation<PreferencesFormValues, unknown, PreferencesFormValues>({
    path: "/api/me",
    method: "PATCH",
    body: (vars) => ({ preferences: vars }),
    invalidate: [ME_QUERY_KEY],
    form,
    successTitle: "Preferences saved",
    successMessage: "Grids and summaries now use your formats.",
    onSuccess: (_data, vars) => form.reset(vars),
  });

  return (
    <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="space-y-4" guardUnsaved>
      <FormField<PreferencesFormValues> name="dateFormat" label="Date format" required description="Used for every date-time column and summary.">
        {(c) => <Select id={c.id} value={c.value ?? null} onChange={(v) => c.onChange(v ?? initial.dateFormat)} onBlur={c.onBlur} invalid={c.invalid} aria-describedby={c["aria-describedby"]} options={dateFormatOptions(c.value ?? initial.dateFormat)} />}
      </FormField>
      <FormField<PreferencesFormValues> name="timeFormat" label="Time format" required>
        {(c) => <Select id={c.id} value={c.value ?? null} onChange={(v) => c.onChange(v ?? initial.timeFormat)} onBlur={c.onBlur} invalid={c.invalid} aria-describedby={c["aria-describedby"]} options={TIME_FORMAT_OPTIONS} />}
      </FormField>
      <FormField<PreferencesFormValues> name="numberFormat" label="Number format" required description="Thousands and decimal separators for quantities and money.">
        {(c) => <Select id={c.id} value={c.value ?? null} onChange={(v) => c.onChange(v ?? initial.numberFormat)} onBlur={c.onBlur} invalid={c.invalid} aria-describedby={c["aria-describedby"]} options={NUMBER_FORMAT_OPTIONS} />}
      </FormField>
      <Preview values={values} />
      <SubmitBar submitLabel="Save preferences" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} pending={mutation.isPending} />
    </Form>
  );
}
