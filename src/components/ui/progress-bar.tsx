import * as React from "react";
import { cn } from "@/lib/utils";

export type ProgressTone = "primary" | "success" | "warning" | "danger";

const TONE: Readonly<Record<ProgressTone, string>> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly tone?: ProgressTone;
  readonly size?: "sm" | "md";
  /** Accessible name. */
  readonly label?: string;
  /** Render "N%" (or custom text) to the right. */
  readonly showValue?: boolean | string;
  readonly className?: string;
}

export function ProgressBar({ value, max = 100, tone = "primary", size = "md", label = "Progress", showValue, className }: ProgressBarProps) {
  const pct = clampPercent(value, max);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(Math.min(Math.max(value, 0), max))}
        className={cn("relative w-full overflow-hidden rounded-full bg-neutral-soft", size === "sm" ? "h-1" : "h-1.5")}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", TONE[tone])} style={{ width: `${pct}%` }} />
      </div>
      {showValue ? <span className="shrink-0 text-2xs font-semibold tabular-nums text-secondary">{typeof showValue === "string" ? showValue : `${Math.round(pct)}%`}</span> : null}
    </div>
  );
}
