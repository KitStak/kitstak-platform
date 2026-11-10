"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlVariants, type ControlSize } from "./control-styles";

export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "size" | "min" | "max" | "step"> {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Fraction digits (0 = integers). Default 0. */
  readonly decimals?: number;
  readonly size?: ControlSize;
  readonly suffix?: React.ReactNode;
  readonly hideStepper?: boolean;
  readonly invalid?: boolean;
}

/** Clamp + round to `decimals`. Exported for tests. */
export function normalizeNumber(raw: number, { min, max, decimals = 0 }: { readonly min?: number; readonly max?: number; readonly decimals?: number }): number {
  const factor = 10 ** decimals;
  let n = Math.round(raw * factor) / factor;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

/** Accepts "1,234.5" and "1234,5" style input; null when empty, NaN when not numeric. */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/\s/g, "");
  const normalised = /,\d{1,2}$/.test(compact) && !compact.includes(".") ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  return /^-?\d*\.?\d+$|^-?\d+\.?$/.test(normalised) ? Number(normalised) : Number.NaN;
}

/** Display form used when not focused, e.g. "1,234.50". */
const format = (value: number | null, decimals: number): string =>
  value === null ? "" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, min, max, step = 1, decimals = 0, size = "md", suffix, hideStepper, invalid, disabled, className, onBlur, onKeyDown, ...props }, ref) => {
    const [text, setText] = React.useState(() => format(value, decimals));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setText(format(value, decimals));
    }, [value, decimals, focused]);

    const commit = (next: number | null) => {
      const normalised = next === null || Number.isNaN(next) ? null : normalizeNumber(next, { min, max, decimals });
      setText(format(normalised, decimals));
      if (normalised !== value) onChange(normalised);
    };

    const bump = (direction: 1 | -1) => {
      const base = value ?? min ?? 0;
      commit(base + direction * step);
    };

    const atMin = min !== undefined && value !== null && value <= min;
    const atMax = max !== undefined && value !== null && value >= max;
    const stepBtn = "flex h-1/2 w-5 items-center justify-center text-faint transition-colors hover:bg-neutral-soft hover:text-body disabled:cursor-not-allowed disabled:opacity-40";

    return (
      <div data-invalid={invalid || undefined} data-disabled={disabled || undefined} className={cn(controlVariants({ size }), "flex items-center gap-1 pr-0", className)}>
        <input
          ref={ref}
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          role="spinbutton"
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = parseNumberText(e.target.value);
            if (parsed === null) onChange(null);
            else if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(parseNumberText(text));
            onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(-1);
            }
            onKeyDown?.(e);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none [appearance:textfield] placeholder:text-faint disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          {...props}
        />
        {suffix ? <span className="shrink-0 text-[12px] text-faint">{suffix}</span> : null}
        {hideStepper ? <span className="w-1.5" /> : (
          <span className="flex h-full flex-col self-stretch border-l border-border-strong/50">
            <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled || atMax} onClick={() => bump(1)} className={cn(stepBtn, "rounded-tr-md")}>
              <ChevronUp className="h-3 w-3" aria-hidden />
            </button>
            <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled || atMin} onClick={() => bump(-1)} className={cn(stepBtn, "rounded-br-md border-t border-border-strong/50")}>
              <ChevronDown className="h-3 w-3" aria-hidden />
            </button>
          </span>
        )}
      </div>
    );
  }
);
NumberInput.displayName = "NumberInput";
