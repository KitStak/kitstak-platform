"use client";

import * as React from "react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SegmentOption<V extends string> {
  readonly value: V;
  readonly label: React.ReactNode;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly disabled?: boolean;
  /** Accessible name when the label is an icon only. */
  readonly ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string> {
  readonly options: readonly SegmentOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  readonly size?: "sm" | "md";
  readonly disabled?: boolean;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/** Single-choice button group (e.g. Equal / Starts With, Large / Small). Never deselects. */
export function SegmentedControl<V extends string>({ options, value, onChange, size = "md", disabled, className, ariaLabel }: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as V);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("inline-flex items-stretch overflow-hidden rounded-md border border-border-strong/70 bg-surface shadow-xs", disabled && "opacity-50", className)}
    >
      {options.map((option, index) => {
        const Icon = option.icon;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={option.ariaLabel}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap text-secondary outline-none transition-colors",
              index > 0 && "border-l border-border-strong/70",
              "hover:bg-surface-sunken hover:text-body focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info/35",
              "data-[state=on]:bg-primary-soft data-[state=on]:text-primary active:bg-neutral-soft",
              "disabled:cursor-not-allowed disabled:text-faint",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]"
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {option.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
