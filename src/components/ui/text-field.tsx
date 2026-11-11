"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlVariants, type ControlSize } from "./control-styles";

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  readonly size?: ControlSize;
  readonly leading?: React.ReactNode;
  readonly trailing?: React.ReactNode;
  /** Show an × button when there is a value; called instead of a synthetic change event. */
  readonly onClear?: () => void;
  /** Render a "12 / 60" counter under the field (needs maxLength). */
  readonly showCount?: boolean;
  readonly invalid?: boolean;
  readonly wrapperClassName?: string;
}

/** Counter text shared by text-field and textarea: "0 / 500". */
export function CharacterCount({ length, max }: { readonly length: number; readonly max: number }) {
  return (
    <span className={cn("block text-right text-[11px] tabular-nums", length >= max ? "text-danger" : "text-faint")} aria-live="polite">
      {length} / {max}
    </span>
  );
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ className, wrapperClassName, size = "md", leading, trailing, onClear, showCount, invalid, disabled, value, defaultValue, maxLength, onChange, ...props }, ref) => {
    const isControlled = value !== undefined;
    const [inner, setInner] = React.useState(String(defaultValue ?? ""));
    const current = isControlled ? String(value ?? "") : inner;
    const ariaInvalid = invalid || props["aria-invalid"] === true || props["aria-invalid"] === "true";

    return (
      <div className={cn("flex w-full flex-col gap-1", wrapperClassName)}>
        <div
          data-invalid={ariaInvalid || undefined}
          data-disabled={disabled || undefined}
          className={cn(controlVariants({ size }), "flex items-center gap-1.5 focus-visible:ring-0", className)}
        >
          {leading ? <span className="flex shrink-0 items-center text-faint">{leading}</span> : null}
          <input
            ref={ref}
            disabled={disabled}
            value={isControlled ? current : undefined}
            defaultValue={isControlled ? undefined : defaultValue}
            maxLength={maxLength}
            aria-invalid={ariaInvalid || undefined}
            onChange={(e) => {
              if (!isControlled) setInner(e.target.value);
              onChange?.(e);
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-inherit outline-none placeholder:text-faint disabled:cursor-not-allowed"
            {...props}
          />
          {onClear && current && !disabled ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                if (!isControlled) setInner("");
                onClear();
              }}
              className="rounded p-0.5 text-faint transition-colors hover:bg-neutral-soft hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {trailing ? <span className="flex shrink-0 items-center text-faint">{trailing}</span> : null}
        </div>
        {showCount && maxLength ? <CharacterCount length={current.length} max={maxLength} /> : null}
      </div>
    );
  }
);
TextField.displayName = "TextField";
