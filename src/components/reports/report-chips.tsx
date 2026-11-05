import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReportChipProps {
  label: string;
  value?: string;
  icon?: LucideIcon;
  active?: boolean;
}

/** Static parameter chip shown under a report header (snapshot date, date range…). */
export function ReportChip({ label, value, icon: Icon, active }: ReportChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium",
        active
          ? "border-primary/30 bg-primary-soft text-primary"
          : "border-border bg-surface text-secondary"
      )}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {label}
      {value ? <span className="font-semibold tabular-nums">{value}</span> : null}
    </span>
  );
}

/** Horizontal row of report parameter chips, aligned with the page gutter. */
export function ReportChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-6 pt-3">{children}</div>;
}
