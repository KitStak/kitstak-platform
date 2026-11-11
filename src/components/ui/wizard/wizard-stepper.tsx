"use client";

import * as React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepMeta } from "./wizard-types";

const STATUS_TEXT = { upcoming: "Not started", active: "Current step", complete: "Completed", attention: "Needs attention" } as const;

/** Horizontal page stepper: icon, "Step N", label; complete / active / attention states. */
export function WizardStepper({ steps, onSelect, className }: { readonly steps: readonly StepMeta[]; readonly onSelect: (key: string) => void; readonly className?: string }) {
  return (
    <nav aria-label="Progress" className={cn("w-full overflow-x-auto", className)}>
      <ol className="flex min-w-max items-stretch gap-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isCurrentAttention = step.status === "attention" && step.current === true;
          const isActive = step.status === "active" || isCurrentAttention;
          const isComplete = step.status === "complete";
          const isAttention = step.status === "attention" && !isCurrentAttention;
          return (
            <li key={step.key} className={cn("flex items-center", index < steps.length - 1 ? "flex-1" : "flex-none")}>
              <button
                type="button"
                disabled={!step.clickable}
                aria-current={isActive ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${step.label} (${STATUS_TEXT[step.status]})`}
                onClick={() => onSelect(step.key)}
                className={cn(
                  "group flex min-w-[148px] flex-none items-center gap-2.5 rounded-lg border px-3 py-2 text-left outline-none transition-[border-color,background-color,box-shadow]",
                  "focus-visible:ring-2 focus-visible:ring-focus/30 disabled:cursor-not-allowed",
                  isActive && "border-primary bg-primary-soft/60 shadow-[0_0_0_1px_var(--primary)]",
                  isAttention && "border-warning/60 bg-warning-soft",
                  !isActive && !isAttention && "border-transparent enabled:hover:border-border enabled:hover:bg-surface-sunken"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                    isComplete && "border-success bg-success text-white",
                    isActive && "border-primary bg-primary text-white",
                    isAttention && "border-warning bg-warning text-white",
                    step.status === "upcoming" && "border-border-strong bg-surface text-faint"
                  )}
                  aria-hidden
                >
                  {isComplete ? <Check className="h-4 w-4" strokeWidth={3} /> : isAttention ? <AlertTriangle className="h-4 w-4" /> : Icon ? <Icon className="h-4 w-4" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-2xs font-medium", isActive ? "text-primary" : isAttention ? "text-warning" : "text-faint")}>
                    Step {index + 1}
                    {step.isOptional ? " · Optional" : ""}
                  </span>
                  <span className={cn("block truncate text-sm font-semibold", step.status === "upcoming" ? "text-secondary" : "text-foreground")}>{step.label}</span>
                </span>
              </button>
              {index < steps.length - 1 ? <span className={cn("mx-3 h-px min-w-6 flex-1", isComplete ? "bg-success" : "bg-border-strong")} aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
