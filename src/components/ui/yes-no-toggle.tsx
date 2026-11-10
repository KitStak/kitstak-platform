"use client";

import * as React from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export interface YesNoToggleProps {
  readonly value: boolean | null;
  readonly onChange: (value: boolean) => void;
  readonly disabled?: boolean;
  readonly yesLabel?: string;
  readonly noLabel?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly id?: string;
  readonly "aria-invalid"?: boolean;
  /** Selected "No" fill: "danger" (default, Logiwa destructive toggles) or "neutral" for plain settings. */
  readonly tone?: "danger" | "neutral";
}

/** Logiwa-style Yes / No pair: green Yes, red No, grey when disabled. */
export const YesNoToggle = React.forwardRef<HTMLDivElement, YesNoToggleProps>(
  ({ value, onChange, disabled, yesLabel = "Yes", noLabel = "No", ariaLabel, className, id, "aria-invalid": invalid, tone = "danger" }, ref) => {
    const current = value === null ? "" : value ? "yes" : "no";
    const item = "inline-flex h-7 min-w-[44px] items-center justify-center px-3 text-[12px] font-semibold outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info/35 disabled:cursor-not-allowed";
    return (
      <ToggleGroup.Root
        ref={ref}
        id={id}
        type="single"
        value={current}
        onValueChange={(next) => {
          if (next) onChange(next === "yes");
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={cn(
          "inline-flex overflow-hidden rounded-md border border-border-strong/70 bg-surface",
          invalid && "border-danger",
          className
        )}
      >
        <ToggleGroup.Item
          value="yes"
          className={cn(item, "text-secondary hover:bg-surface-sunken", disabled ? "data-[state=on]:bg-neutral-soft data-[state=on]:text-neutral" : "data-[state=on]:bg-success data-[state=on]:text-white")}
        >
          {yesLabel}
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="no"
          className={cn(item, "border-l border-border-strong/70 text-secondary hover:bg-surface-sunken", disabled ? "data-[state=on]:bg-neutral-soft data-[state=on]:text-neutral" : tone === "neutral" ? "data-[state=on]:bg-neutral-soft data-[state=on]:text-foreground" : "data-[state=on]:bg-danger data-[state=on]:text-white")}
        >
          {noLabel}
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    );
  }
);
YesNoToggle.displayName = "YesNoToggle";
