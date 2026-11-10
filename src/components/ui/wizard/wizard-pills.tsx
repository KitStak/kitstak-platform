"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { StepMeta } from "./wizard-types";

/** Drawer-style compact steps: "1.General  2.Kit  3.Pack Types". */
export function WizardPills({ steps, onSelect, className }: { readonly steps: readonly StepMeta[]; readonly onSelect: (key: string) => void; readonly className?: string }) {
  return (
    <nav aria-label="Steps" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {steps.map((step, index) => (
        <button
          key={step.key}
          type="button"
          disabled={!step.clickable}
          aria-current={step.status === "active" ? "step" : undefined}
          onClick={() => onSelect(step.key)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed",
            step.status === "active" && "border-primary bg-primary text-white",
            step.status === "complete" && "border-success/40 bg-success-soft text-success enabled:hover:border-success",
            step.status === "attention" && "border-warning/50 bg-warning-soft text-warning",
            step.status === "upcoming" && "border-border bg-surface text-secondary enabled:hover:border-border-strong enabled:hover:text-body disabled:text-faint"
          )}
        >
          <span className="tabular-nums">{index + 1}.</span>
          {step.label}
        </button>
      ))}
    </nav>
  );
}
