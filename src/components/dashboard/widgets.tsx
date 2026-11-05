"use client";

import * as React from "react";
import {
  Globe2,
  type LucideIcon,
  Moon,
  Store,
  Sunrise,
  Truck,
  Users2,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";

/* ---------- Progress for Today ---------- */

export interface ProgressMetric {
  label: string;
  sub: string;
  percent: number;
  current: number;
  target: number;
}

export function ProgressTodayCard({
  shiftDate,
  nowLabel,
  shiftStart,
  shiftEnd,
  shiftPercent,
  metrics,
}: {
  shiftDate: string;
  nowLabel: string;
  shiftStart: string;
  shiftEnd: string;
  shiftPercent: number;
  metrics: ProgressMetric[];
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader title="Progress for Today" info />
      <div className="mx-5 rounded-lg bg-surface-sunken p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Day Shift</p>
            <p className="text-[11px] text-faint">{shiftDate}</p>
          </div>
          <p className="text-[13px] tabular-nums">
            <span className="font-semibold text-success">{nowLabel}</span>
            <span className="font-normal text-faint"> – {shiftEnd}</span>
          </p>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${Math.min(100, Math.max(0, shiftPercent))}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1 font-medium text-warning">
            <Sunrise className="h-3.5 w-3.5" aria-hidden /> {shiftStart}
          </span>
          <span className="flex items-center gap-1 text-secondary">
            {shiftEnd} <Moon className="h-3 w-3" aria-hidden />
          </span>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border px-5 pb-4">
        {metrics.map((m) => (
          <div key={m.label} className="py-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-semibold text-foreground">{m.label}</p>
              <p className="text-[13px] font-semibold tabular-nums">
                <span className="text-success">{formatNumber(m.current)}</span>
                <span className="text-secondary"> – {formatNumber(m.target)}</span>
              </p>
            </div>
            <p className="text-[11px] text-faint">
              <span className={cn("font-semibold", m.percent > 0 ? "text-success" : "text-faint")}>
                {m.percent}%
              </span>{" "}
              {m.sub}
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-success transition-[width] duration-700"
                style={{ width: `${Math.min(100, m.percent)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Unfulfilled donut ---------- */

export interface DonutRow {
  label: string;
  tone: "foreground" | "warning" | "primary";
  orders: number;
  packQty: number;
}

/** Donut geometry: 180px square per the enterprise-dense card spec. */
const DONUT_SIZE = 180;
const DONUT_STROKE = 13;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_COLOR_IN_PROGRESS = "#2563eb";
const DONUT_COLOR_OPEN = "#f59e0b";

/** Arc length for a value, normalized against the series sum (never a fixed max). */
function donutArcLength(value: number, seriesSum: number): number {
  if (seriesSum <= 0 || value <= 0) return 0;
  return (value / seriesSum) * DONUT_CIRCUMFERENCE;
}

export function UnfulfilledCard({
  total,
  rows,
  open,
  inProgress,
}: {
  total: number;
  rows: DonutRow[];
  open: number;
  inProgress: number;
}) {
  // Value-to-angle mapping normalizes against the series sum so the two
  // segments always close the ring (e.g. 52 + 11 -> ~297deg + ~63deg).
  const seriesSum = open + inProgress;
  const inProgressArc = donutArcLength(inProgress, seriesSum);
  const openArc = donutArcLength(open, seriesSum);
  const toneClass = {
    foreground: "text-foreground",
    warning: "text-warning",
    primary: "text-primary",
  } as const;

  return (
    <Card className="flex flex-col">
      <CardHeader title="Unfulfilled Orders" info />
      {/* CardHeader contributes 12px below the title; pt-1 brings the title-to-content gap to 16px.
          flex-1 + items-stretch let the table column fill the card's inner height so the
          rows distribute instead of leaving a dead zone below "In Progress". */}
      <div className="flex flex-1 items-stretch gap-8 px-6 pb-5 pt-1">
        <div className="flex shrink-0 flex-col items-center justify-center gap-3">
          <div className="relative h-[180px] w-[180px]">
            <svg
              viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
              className="h-full w-full -rotate-90"
              role="img"
              aria-label={`${formatNumber(inProgress)} in progress and ${formatNumber(open)} open of ${formatNumber(total)} unfulfilled orders`}
            >
              {/* Neutral track only shows when the series is empty. */}
              <circle
                cx={DONUT_SIZE / 2}
                cy={DONUT_SIZE / 2}
                r={DONUT_RADIUS}
                fill="none"
                stroke="var(--border)"
                strokeWidth={DONUT_STROKE}
              />
              {inProgressArc > 0 ? (
                <circle
                  cx={DONUT_SIZE / 2}
                  cy={DONUT_SIZE / 2}
                  r={DONUT_RADIUS}
                  fill="none"
                  stroke={DONUT_COLOR_IN_PROGRESS}
                  strokeWidth={DONUT_STROKE}
                  strokeDasharray={`${inProgressArc} ${DONUT_CIRCUMFERENCE}`}
                />
              ) : null}
              {openArc > 0 ? (
                <circle
                  cx={DONUT_SIZE / 2}
                  cy={DONUT_SIZE / 2}
                  r={DONUT_RADIUS}
                  fill="none"
                  stroke={DONUT_COLOR_OPEN}
                  strokeWidth={DONUT_STROKE}
                  strokeDasharray={`${openArc} ${DONUT_CIRCUMFERENCE}`}
                  strokeDashoffset={-inProgressArc}
                />
              ) : null}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[11px] text-faint">Total Orders</p>
              <p className="text-[26px] font-bold tabular-nums text-foreground">
                {formatNumber(total)}
              </p>
            </div>
          </div>
          {/* Legend carries the data, not just color keys: "In Progress 34 · Open 11". */}
          <div className="flex items-center justify-center gap-2 text-[12px] text-secondary">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: DONUT_COLOR_IN_PROGRESS }}
              />{" "}
              In Progress{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatNumber(inProgress)}
              </span>
            </span>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: DONUT_COLOR_OPEN }}
              />{" "}
              Open{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatNumber(open)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-10 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span />
            <span className="text-right">Total Orders</span>
            <span className="text-right">Pack Quantity</span>
          </div>
          {/* Rows are flex-1 (min 56px) so Total/Open/In Progress distribute across the
              card's full inner height; divide-y hairlines span the table's full width. */}
          <div className="flex flex-1 flex-col divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid min-h-14 flex-1 grid-cols-[1fr_auto_auto] items-center gap-x-10"
              >
                <span className={cn("text-[13px] font-semibold", toneClass[row.tone])}>
                  {row.label}
                </span>
                <span className="text-right text-[15px] font-bold tabular-nums text-foreground">
                  {formatNumber(row.orders)}
                </span>
                <span className="text-right text-[15px] font-bold tabular-nums text-foreground">
                  {formatNumber(row.packQty)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Status breakdown ---------- */

export function StatusBreakdownCard({
  entries,
}: {
  entries: { label: string; count: number; emphasis?: boolean }[];
}) {
  return (
    <Card>
      <CardHeader title="Order Breakdown by Status" info />
      <div className="grid grid-cols-2 gap-x-10 gap-y-2.5 px-6 pb-5 md:grid-cols-4">
        {entries.map((e) => (
          <div key={e.label} className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="text-secondary">{e.label}</span>
            <span
              className={cn(
                "font-bold tabular-nums",
                e.emphasis && e.count > 0 ? "text-danger" : "text-foreground"
              )}
            >
              {formatNumber(e.count)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Rank card ---------- */

/**
 * Icons are referenced by name (not passed as component functions) so server
 * pages can render RankCard without sending functions across the RSC boundary.
 */
const RANK_ICONS: Record<RankIconName, LucideIcon> = {
  store: Store,
  users: Users2,
  truck: Truck,
  globe: Globe2,
};

export type RankIconName = "store" | "users" | "truck" | "globe";

export function RankCard({
  icon = "globe",
  title,
  description,
  rows,
  totalEntries,
}: {
  icon?: RankIconName;
  title: string;
  description: string;
  rows: { name: string; percent: number; count: number }[];
  /** Total number of ranked entries available (rows may be a truncated top-N slice). */
  totalEntries?: number;
}) {
  const Icon = RANK_ICONS[icon];
  const moreCount = Math.max(0, (totalEntries ?? rows.length) - rows.length);
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken">
          <Icon className="h-4.5 w-4.5 text-secondary" aria-hidden />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          <p className="text-[11px] leading-4 text-faint">{description}</p>
        </div>
      </div>
      <div className="mx-5 flex flex-col divide-y divide-border border-t border-border">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-faint">No orders in range</p>
        ) : (
          rows.map((row, i) => (
            <div key={row.name} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {i + 1}. {row.name}
                </p>
                <p className="text-[11px] text-faint">
                  <span className="font-semibold text-secondary">{row.percent}%</span> of
                  all orders
                </p>
              </div>
              <span className="text-[15px] font-bold tabular-nums text-foreground">
                {formatNumber(row.count)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="mx-5 mt-auto border-t border-border pb-4 pt-2.5 text-[11px] text-faint">
        {moreCount > 0
          ? `+ ${formatNumber(moreCount)} more`
          : `All ${formatNumber(rows.length)} shown`}
      </div>
    </Card>
  );
}
