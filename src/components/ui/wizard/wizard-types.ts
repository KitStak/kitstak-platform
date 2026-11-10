import type * as React from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import type { z } from "zod";

export type WizardMode = "linear" | "free";
export type StepStatus = "upcoming" | "active" | "complete" | "attention";

export interface WizardStepContext<T extends FieldValues> {
  readonly form: UseFormReturn<T>;
  readonly values: T;
  readonly goTo: (key: string) => void;
  /** Routes server field errors (`{ "lines.0.qty": ["…"] }`) to their owning steps; see WizardController. */
  readonly applyServerErrors?: (fieldErrors: ServerFieldErrors) => boolean;
}

/** Server validation errors keyed by dot path (ApiError.fieldErrors shape). */
export type ServerFieldErrors = Readonly<Record<string, readonly string[] | string | undefined>>;

export interface WizardStep<T extends FieldValues> {
  readonly key: string;
  readonly label: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly description?: string;
  /** Validates this step's slice of the values on Next (object schema; extra keys pass). */
  readonly schema?: z.ZodType;
  readonly render: (ctx: WizardStepContext<T>) => React.ReactNode;
  readonly isOptional?: boolean;
  /**
   * Gate for Next: `true` lets the user continue; `false` or a reason string disables Next
   * (the string is shown as the disabled-reason tooltip), e.g. `(v) => v.lines.length > 0 || "Add at least one product"`.
   */
  readonly canProceed?: (values: T) => boolean | string;
  /** While true (e.g. the step's data is loading) Next shows a spinner and is disabled. */
  readonly busy?: (values: T) => boolean;
  /** Render the step heading for screen readers only (the body opens with its own section title). */
  readonly hideHeading?: boolean;
}

/** Disabled reason for Next on a step, or null when the user may continue. */
export function proceedReason<T extends FieldValues>(step: WizardStep<T>, values: T): string | null {
  const verdict = step.canProceed?.(values);
  if (verdict === undefined || verdict === true) return null;
  return typeof verdict === "string" && verdict.trim() ? verdict : "Complete this step to continue";
}

/** What the stepper / pills need to draw a step. */
export interface StepMeta {
  readonly key: string;
  readonly label: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly status: StepStatus;
  readonly clickable: boolean;
  readonly isOptional?: boolean;
  /** The step being shown (an attention step can also be current). */
  readonly current?: boolean;
}
