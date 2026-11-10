"use client";

/**
 * Per-field inline validation for a wizard step (Logiwa parity: touching a required field
 * and leaving it empty shows "<Label> is required." under it at once). The shared wizard
 * form runs without a resolver and only validates a step on Next, so this hook validates
 * the step schema whenever a watched field is touched or changes after being touched.
 */
import * as React from "react";
import { useFormState, useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

/** First schema issue per top-level field (pure; unit tested). */
export function issuesByField(schema: z.ZodType, values: unknown): Readonly<Record<string, string>> {
  const r = schema.safeParse(values);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

export function useBlurValidation<T extends FieldValues>(form: UseFormReturn<T>, schema: z.ZodType, fields: readonly Path<T>[]): void {
  const values = useWatch({ control: form.control });
  const { touchedFields, isSubmitted } = useFormState({ control: form.control });
  const touchedKey = fields.filter((f) => Boolean((touchedFields as Record<string, unknown>)[f])).join("|");
  React.useEffect(() => {
    const issues = issuesByField(schema, form.getValues());
    const touched = new Set(touchedKey ? touchedKey.split("|") : []);
    for (const f of fields) {
      if (!touched.has(f) && !isSubmitted) continue;
      const message = issues[f];
      const current = form.getFieldState(f).error;
      if (message && current?.message !== message) form.setError(f, { type: "step", message });
      else if (!message && current && current.type === "step") form.clearErrors(f);
    }
  }, [values, touchedKey, isSubmitted, schema, fields, form]);
}
