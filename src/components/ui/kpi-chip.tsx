import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type KpiTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "teal";

const DOT: Readonly<Record<KpiTone, string>> = {
  neutral: "bg-neutral",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  // Same hue as the teal status pill (work order Open, shipment plan Open).
  teal: "bg-[#16C2AA]",
};

export interface KpiChipProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly tone?: KpiTone;
  readonly href?: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
}

/** Compact "• Late 12" counter used in toolbars and summary rows; optional drilldown. */
export function KpiChip({ label, value, tone = "neutral", href, active, onClick, className }: KpiChipProps) {
  const classes = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
    active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-body",
    (href || onClick) && "hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30",
    className
  );
  const inner = (
    <>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} aria-hidden />
      <span className="text-secondary">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </>
  );
  if (href) return <Link href={href} className={classes} aria-current={active ? "true" : undefined}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={active} className={classes}>{inner}</button>;
  return <span className={classes}>{inner}</span>;
}
