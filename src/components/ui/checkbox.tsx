"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckedState = boolean | "indeterminate";

export interface CheckboxProps extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "checked" | "onCheckedChange"> {
  readonly checked?: CheckedState;
  readonly onCheckedChange?: (checked: CheckedState) => void;
  readonly label?: React.ReactNode;
  readonly description?: React.ReactNode;
}

/** Tri-state checkbox (checked / unchecked / indeterminate), Radix-based. */
export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, label, description, id, checked, ...props }, ref) => {
    const autoId = React.useId();
    const boxId = id ?? autoId;
    const box = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={boxId}
        checked={checked}
        className={cn(
          "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border-strong bg-surface text-white outline-none transition-colors",
          "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-info/30",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
          "aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-45",
          className
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="inline-flex">
          {checked === "indeterminate" ? <Minus className="h-3 w-3" strokeWidth={3.5} aria-hidden /> : <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
    if (!label) return box;
    return (
      <div className="flex items-start gap-2">
        <div className="pt-0.5">{box}</div>
        <div className="flex flex-col">
          <label htmlFor={boxId} className="cursor-pointer text-[13px] text-body">
            {label}
          </label>
          {description ? <span className="text-[11px] leading-4 text-faint">{description}</span> : null}
        </div>
      </div>
    );
  }
);
Checkbox.displayName = "Checkbox";
