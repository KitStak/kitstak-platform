"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionCards, type EmptyStateAction } from "../empty-state";
import type { WizardMode } from "./wizard-types";

/** Mode of the wizard rendering the success screen: edit ("free") flows say "updated". */
export const WizardModeContext = React.createContext<WizardMode | null>(null);

export interface WizardSuccessProps {
  /** e.g. "Shipment Order SO000123" → "You have successfully created Shipment Order SO000123". */
  readonly entity: React.ReactNode;
  /** Defaults to "created" in linear (create) wizards and "updated" in free (edit) ones. */
  readonly verb?: string;
  readonly description?: React.ReactNode;
  readonly options: readonly EmptyStateAction[];
  readonly className?: string;
}

/** Completion screen: "You have successfully created … / What can you do next?" with option cards. */
export function WizardSuccess({ entity, verb, description, options, className }: WizardSuccessProps) {
  const mode = React.useContext(WizardModeContext);
  const action = verb ?? (mode === "free" ? "updated" : "created");
  return (
    <div className={cn("flex flex-col items-center", className)} role="status">
      <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
      <h2 className="mt-3 text-center text-lg font-semibold text-foreground">
        You have successfully {action} {entity}
      </h2>
      {description ? <p className="mt-1 max-w-[480px] text-center text-sm text-secondary">{description}</p> : null}
      {options.length ? (
        <>
          <p className="mt-6 text-xs font-semibold text-faint">What can you do next?</p>
          <ActionCards cards={options} className="mt-3" />
        </>
      ) : null}
    </div>
  );
}
