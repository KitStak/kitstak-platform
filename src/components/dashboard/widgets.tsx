"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  Globe2,
  type LucideIcon,
  Moon,
  Sunrise,
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
          <p className="text-[13px] font-semibold tabular-nums">
            <span className="text-success">{nowLabel}</span>
            <span className="text-secondary"> – {shiftEnd}</span>
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
  const data = [
    { name: "Open", value: open },
    { name: "In Progress", value: inProgress },
  ];
  const COLORS = ["#f2a712", "#2e5ce6"];
  const toneClass = {
    foreground: "text-foreground",
    warning: "text-warning",
    primary: "text-primary",
  } as const;

  return (
    <Card>
      <CardHeader title="Unfulfilled Orders" info />
      <div className="flex items-center gap-8 px-6 pb-5">
        <div className="relative h-44 w-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={62}
                outerRadius={74}
                strokeWidth={0}
                startAngle={90}
                endAngle={-270}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[11px] text-faint">Total Orders</p>
            <p className="text-[26px] font-bold tabular-nums text-foreground">
              {formatNumber(total)}
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-col divide-y divide-border">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-10 pb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span />
            <span className="text-right">Total Orders</span>
            <span className="text-right">Pack Quantity</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-10 py-2.5"
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
          <div className="flex items-center gap-4 pt-3 text-[11px] text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#2e5ce6]" /> In Progress
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#f2a712]" /> Open
            </span>
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

export function RankCard({
  icon: Icon = Globe2,
  title,
  description,
  rows,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  rows: { name: string; percent: number; count: number }[];
}) {
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
      <div className="mx-5 mb-4 flex flex-col divide-y divide-border border-t border-border">
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
    </Card>
  );
}
