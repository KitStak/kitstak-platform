import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";
import { Skeleton } from "./card";

export interface StatTileProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly sublabel?: React.ReactNode;
  readonly icon?: React.ComponentType<{ className?: string }>;
  /** Signed change; positive is good unless `invertDelta`. */
  readonly delta?: { readonly value: number; readonly label?: string; readonly invert?: boolean };
  readonly info?: React.ReactNode;
  /** Accessible name of the info button (default "More information"); name it uniquely when a page has several. */
  readonly infoLabel?: string;
  /** Drilldown: the whole tile becomes a link to a pre-filtered list. */
  readonly href?: string;
  readonly loading?: boolean;
  readonly tone?: "default" | "primary" | "success" | "warning" | "danger";
  readonly className?: string;
}

const ICON_TONE = {
  default: "bg-neutral-soft text-secondary",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

export function StatTile({ label, value, sublabel, icon: Icon, delta, info, infoLabel, href, loading, tone = "default", className }: StatTileProps) {
  const good = delta ? (delta.invert ? delta.value < 0 : delta.value > 0) : false;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          {label}
          {info ? <InfoTip content={info} label={infoLabel} /> : null}
        </span>
        {Icon ? (
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", ICON_TONE[tone])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <div className="mt-1 text-[24px] font-semibold leading-8 tracking-tight tabular-nums text-foreground">{value}</div>}
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        {delta && !loading ? (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", delta.value === 0 ? "text-secondary" : good ? "text-success" : "text-danger")}>
            {delta.value > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : delta.value < 0 ? <ArrowDownRight className="h-3.5 w-3.5" aria-hidden /> : null}
            {delta.value > 0 ? "+" : ""}
            {delta.value}%{delta.label ? <span className="ml-1 font-normal text-faint">{delta.label}</span> : null}
          </span>
        ) : null}
        {sublabel ? <span className="truncate text-faint" title={typeof sublabel === "string" ? sublabel : undefined}>{sublabel}</span> : null}
      </div>
    </>
  );
  const classes = cn("block rounded-lg border border-border bg-surface px-4 py-3.5 shadow-xs", className);
  if (!href) return <div className={classes}>{body}</div>;
  return (
    <Link href={href} className={cn(classes, "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 active:shadow-xs")}>
      {body}
    </Link>
  );
}
