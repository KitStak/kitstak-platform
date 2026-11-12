"use client";

import * as React from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { cn } from "@/lib/utils";
import { Button } from "../button";
import { Spinner } from "../spinner";
import { DisabledReason } from "../tooltip";

export interface SubmitBarProps {
  readonly submitLabel?: string;
  readonly cancelLabel?: string;
  readonly onCancel?: () => void;
  /** Extra controls on the left (e.g. "Save & create another"). */
  readonly secondary?: React.ReactNode;
  /** Require changes before Save enables (edit forms). Default false. */
  readonly requireDirty?: boolean;
  /** External busy state (e.g. mutation pending). */
  readonly pending?: boolean;
  readonly sticky?: boolean;
  readonly className?: string;
}

export function submitDisabledReason({ isSubmitting, pending, hasErrors, requireDirty, isDirty }: { readonly isSubmitting: boolean; readonly pending: boolean; readonly hasErrors: boolean; readonly requireDirty: boolean; readonly isDirty: boolean }): string | null {
  if (isSubmitting || pending) return "Saving…";
  if (hasErrors) return "Fix the highlighted fields first";
  if (requireDirty && !isDirty) return "No changes to save";
  return null;
}

/**
 * Cancel / Save. Save is disabled while the form has validation errors or is
 * submitting, with the reason in a tooltip. (Errors appear once fields are touched or
 * on the first submit attempt, so an untouched create form can still be submitted to
 * reveal everything that is required.)
 */
export function SubmitBar({ submitLabel = "Save", cancelLabel = "Cancel", onCancel, secondary, requireDirty = false, pending = false, sticky, className }: SubmitBarProps) {
  const { control } = useFormContext();
  const { isSubmitting, isDirty, errors } = useFormState({ control });
  const hasErrors = Object.keys(errors).length > 0;
  const reason = submitDisabledReason({ isSubmitting, pending, hasErrors, requireDirty, isDirty });
  const busy = isSubmitting || pending;

  return (
    <div data-sticky-footer={sticky ? "" : undefined} className={cn("flex items-center justify-between gap-2", sticky && "sticky bottom-0 z-10 -mx-5 border-t border-border bg-surface px-5 py-3 shadow-[0_-4px_8px_-6px_rgba(16,24,40,0.15)]", className)}>
      <div className="flex items-center gap-2">{secondary}</div>
      <div className="flex items-center gap-2">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        ) : null}
        <DisabledReason reason={busy ? null : reason}>
          <Button type="submit" variant="primary" disabled={reason !== null} aria-busy={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
            {submitLabel}
          </Button>
        </DisabledReason>
      </div>
    </div>
  );
}
