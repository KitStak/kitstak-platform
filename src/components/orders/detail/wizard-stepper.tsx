import * as React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStepState = "complete" | "attention" | "none";

export interface WizardStep {
  key: string;
  /** "Step 1" … "Step 6" */
  stepLabel: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  state: WizardStepState;
}

export interface WizardStepperProps {
  steps: WizardStep[];
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * Horizontal 6-step wizard header card (Logiwa "Edit Shipment Order" pattern).
 * Each step: circled icon + "Step N" + name, with a green check when complete
 * or an amber ! when the step needs attention. Clicking switches the section.
 * Tiles share a fixed 72px height and one-line labels so all six read as one row.
 */
const TILE_HEIGHT_CLASS = "h-[72px]";
export function WizardStepper({ steps, activeKey, onSelect, className }: WizardStepperProps) {
  return (
    <div
      role="tablist"
      aria-label="Order sections"
      className={cn(
        "flex items-stretch divide-x divide-border overflow-x-auto rounded-lg border border-border bg-surface shadow-xs",
        className
      )}
    >
      {steps.map((step) => {
        const isActive = step.key === activeKey;
        const Icon = step.icon;
        return (
          <button
            key={step.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(step.key)}
            className={cn(
              "group relative flex min-w-[140px] flex-1 items-center gap-2.5 px-3 text-left outline-none transition-colors",
              TILE_HEIGHT_CLASS,
              "hover:bg-surface-sunken/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
              isActive && "bg-primary-soft/40"
            )}
          >
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
              />
            ) : null}
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                isActive
                  ? "border-primary bg-primary text-white"
                  : step.state === "complete"
                    ? "border-success/50 bg-success-soft text-success"
                    : step.state === "attention"
                      ? "border-warning/60 bg-warning-soft text-warning"
                      : "border-border-strong bg-surface text-faint group-hover:text-secondary"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-faint">
                {step.stepLabel}
              </span>
              <span className="flex items-center gap-1">
                <span
                  className={cn(
                    // Labels never wrap: every tile keeps a single-line name so
                    // the state icon sits inline right after the text.
                    "whitespace-nowrap text-[12px] font-semibold leading-4",
                    isActive
                      ? "text-primary"
                      : step.state === "complete"
                        ? "text-success"
                        : step.state === "attention"
                          ? "text-warning"
                          : "text-secondary"
                  )}
                >
                  {step.name}
                </span>
                {step.state === "complete" ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0 text-success"
                    aria-label="Complete"
                  />
                ) : step.state === "attention" ? (
                  <AlertCircle
                    className="h-3.5 w-3.5 shrink-0 text-warning"
                    aria-label="Needs attention"
                  />
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
