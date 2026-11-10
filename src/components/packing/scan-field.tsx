"use client";

/**
 * Station scan input. A keyboard-wedge scanner types fast and ends with Enter (or Tab);
 * both submit, and the field clears and keeps focus for the next scan. A red flash
 * marks a rejected scan, a green one an accepted scan.
 */
import * as React from "react";
import { ScanLine, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const SHAKE_CSS = "@keyframes kshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}@media (prefers-reduced-motion: reduce){@keyframes kshake{0%,100%{transform:none}}}";

export type ScanFlash = "ok" | "error" | null;

export interface ScanFieldHandle {
  readonly focus: () => void;
  readonly flash: (kind: Exclude<ScanFlash, null>) => void;
}

export interface ScanFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly onScan: (code: string) => void | Promise<void>;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly autoFocus?: boolean;
  readonly clearable?: boolean;
  readonly error?: string | null;
  readonly hint?: React.ReactNode;
  readonly size?: "md" | "lg";
  readonly className?: string;
  /** Fires on every keystroke (e.g. to clear a stale error as soon as the value changes). */
  readonly onValueChange?: (value: string) => void;
}

export const ScanField = React.forwardRef<ScanFieldHandle, ScanFieldProps>(function ScanField(
  { id, label, placeholder = "Scan or type, then press Enter", onScan, disabled, busy, autoFocus, clearable = true, error, hint, size = "lg", className, onValueChange },
  ref
) {
  const input = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState("");
  const [flash, setFlash] = React.useState<ScanFlash>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFlash = React.useCallback((kind: Exclude<ScanFlash, null>) => {
    setFlash(kind);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), kind === "error" ? 900 : 450);
  }, []);
  React.useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), flash: doFlash }), [doFlash]);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const submit = async () => {
    const code = value.trim();
    if (!code || disabled || busy) return;
    setValue("");
    await onScan(code);
    // Keep focus for the next scan, unless the scan moved focus on purpose
    // (an order scan hands focus to the product field).
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || active === document.body || active === input.current) input.current?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <style>{SHAKE_CSS}</style>
      <label htmlFor={id} className="text-[12px] font-semibold text-body">{label}</label>
      <div
        className={cn(
          "relative flex items-center rounded-lg border bg-surface transition-[box-shadow,border-color,background-color] duration-150",
          size === "lg" ? "h-12" : "h-9",
          flash === "error" ? "animate-[kshake_.3s] border-danger bg-danger-soft shadow-[0_0_0_3px_rgba(178,11,28,.18)]" : flash === "ok" ? "border-success shadow-[0_0_0_3px_rgba(23,135,77,.18)]" : error ? "border-danger" : "border-border-strong focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(13,54,163,.15)]",
          disabled && "opacity-60"
        )}
      >
        <ScanLine className={cn("ml-3 h-5 w-5 shrink-0", flash === "error" ? "text-danger" : "text-secondary")} aria-hidden />
        <input
          ref={input}
          id={id}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => { setValue(e.target.value); onValueChange?.(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || (e.key === "Tab" && value.trim())) {
              e.preventDefault();
              void submit();
            }
          }}
          className={cn("min-w-0 flex-1 bg-transparent px-3 font-mono outline-none placeholder:font-sans placeholder:text-faint", size === "lg" ? "text-[16px]" : "text-[13px]")}
        />
        {busy ? <Spinner className="mr-3 h-4 w-4" label="Looking up" /> : null}
        {clearable && value && !busy ? (
          <button type="button" aria-label="Clear" onClick={() => { setValue(""); input.current?.focus(); }} className="mr-2 rounded p-1 text-faint hover:bg-surface-sunken hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {error ? <p id={`${id}-err`} role="alert" className="text-[12px] font-medium text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="text-[11px] text-secondary">{hint}</p> : null}
    </div>
  );
});
