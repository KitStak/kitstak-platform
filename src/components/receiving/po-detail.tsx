"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, PackageCheck } from "lucide-react";
import type { PurchaseOrderLineRow } from "@/server/repositories/purchase-orders";
import { Breadcrumbs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/utils";

const MS_PER_DAY = 86_400_000;

/** Serializable PO shape handed down from the server page. */
export interface PoDetailData {
  id: string;
  code: string;
  vendorName: string;
  referenceNumber: string | null;
  status: string;
  poType: string;
  totalQuantity: number;
  receivedQuantity: number;
  purchasePrice: number;
  expectedDate: string | null;
  receivedAt: string | null;
  createdAt: string;
  clientName: string;
  clientCode: string;
  warehouseLabel: string;
}

export interface PoDetailProps {
  po: PoDetailData;
  lines: PurchaseOrderLineRow[];
}

function etaLabel(po: PoDetailData): { text: string; tone: "ok" | "warn" | "muted" } {
  if (po.status === "Completed" && po.receivedAt) {
    return { text: `Received ${formatDate(po.receivedAt)}`, tone: "ok" };
  }
  if (po.status === "Cancelled") return { text: "Order cancelled", tone: "muted" };
  if (!po.expectedDate) return { text: "No expected date", tone: "muted" };
  const days = Math.ceil((new Date(po.expectedDate).getTime() - Date.now()) / MS_PER_DAY);
  if (Number.isNaN(days)) return { text: "No expected date", tone: "muted" };
  if (days > 1) return { text: `Due in ${days} days`, tone: "muted" };
  if (days === 1) return { text: "Due tomorrow", tone: "warn" };
  if (days === 0) return { text: "Due today", tone: "warn" };
  return { text: `Overdue by ${Math.abs(days)} day${days === -1 ? "" : "s"}`, tone: "warn" };
}

function ProgressHero({ po, lineCount }: { po: PoDetailData; lineCount: number }) {
  const pct =
    po.totalQuantity > 0
      ? Math.min(100, Math.round((po.receivedQuantity / po.totalQuantity) * 100))
      : 0;
  const remaining = Math.max(0, po.totalQuantity - po.receivedQuantity);
  const eta = etaLabel(po);
  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
            Receiving progress
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-8 tabular-nums text-foreground">
              {formatNumber(po.receivedQuantity)}
            </span>
            <span className="text-[14px] text-faint">
              / {formatNumber(po.totalQuantity)} units received
            </span>
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              Remaining
            </p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {formatNumber(remaining)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              Lines
            </p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
              {formatNumber(lineCount)}
            </p>
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold",
              eta.tone === "ok" && "bg-success-soft text-success",
              eta.tone === "warn" && "bg-warning-soft text-warning",
              eta.tone === "muted" && "bg-neutral-soft text-neutral"
            )}
          >
            {eta.tone === "ok" ? (
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            )}
            {eta.text}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-soft"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% of ordered units received`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              pct >= 100 ? "bg-success" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-10 text-right text-[13px] font-semibold tabular-nums text-foreground">
          {pct}%
        </span>
      </div>
    </Card>
  );
}

const thClass =
  "whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint";
const numTd = "px-4 text-right text-[13px] tabular-nums text-body";

function LinesTable({ lines }: { lines: PurchaseOrderLineRow[] }) {
  const totals = lines.reduce(
    (acc, line) => ({
      ordered: acc.ordered + line.orderedQuantity,
      received: acc.received + line.receivedQuantity,
      value: acc.value + line.orderedQuantity * line.unitCost,
    }),
    { ordered: 0, received: 0, value: 0 }
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Order lines"
        description={`${lines.length} SKU${lines.length === 1 ? "" : "s"} on this purchase order`}
      />
      <div className="ks-scroll overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead className="bg-surface shadow-[inset_0_-1px_0_var(--border)]">
            <tr>
              <th className={thClass}>SKU</th>
              <th className={thClass}>Product</th>
              <th className={cn(thClass, "text-right")}>Ordered</th>
              <th className={cn(thClass, "text-right")}>Received</th>
              <th className={cn(thClass, "text-right")}>Remaining</th>
              <th className={cn(thClass, "text-right")}>Unit Cost</th>
              <th className={cn(thClass, "text-right")}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity);
              return (
                <tr
                  key={line.id}
                  className="h-10 border-t border-border transition-colors hover:bg-surface-sunken"
                >
                  <td className="px-4">
                    <Link
                      href={`/products/${line.productId}`}
                      className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {line.sku}
                    </Link>
                  </td>
                  <td className="max-w-[320px] truncate px-4 text-body">{line.productName}</td>
                  <td className={numTd}>{formatNumber(line.orderedQuantity)}</td>
                  <td className={numTd}>{formatNumber(line.receivedQuantity)}</td>
                  <td
                    className={cn(
                      numTd,
                      remaining > 0 ? "font-medium text-warning" : "text-faint"
                    )}
                  >
                    {remaining > 0 ? formatNumber(remaining) : "—"}
                  </td>
                  <td className={numTd}>{formatMoney(line.unitCost)}</td>
                  <td className={cn(numTd, "font-medium text-foreground")}>
                    {formatMoney(line.orderedQuantity * line.unitCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="h-10 border-t border-border bg-surface-sunken/60">
              <td className="px-4 text-[12px] font-semibold uppercase tracking-[0.04em] text-faint">
                Totals
              </td>
              <td />
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatNumber(totals.ordered)}
              </td>
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatNumber(totals.received)}
              </td>
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatNumber(Math.max(0, totals.ordered - totals.received))}
              </td>
              <td />
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatMoney(totals.value)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2">
      <span className="text-[12px] text-faint">{label}</span>
      <span className="text-right text-[13px] font-medium text-body">{value}</span>
    </div>
  );
}

function SummaryRail({ po, lineValue }: { po: PoDetailData; lineValue: number }) {
  const receivable = po.status !== "Completed" && po.status !== "Cancelled";
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
      <Button variant="primary" size="lg" className="w-full" disabled={!receivable}>
        <PackageCheck className="h-4 w-4" aria-hidden />
        Receive Items
      </Button>
      <Card className="py-1.5">
        <p className="px-5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          Summary
        </p>
        <SummaryRow label="Vendor" value={po.vendorName} />
        <SummaryRow label="Client" value={`${po.clientName} (${po.clientCode})`} />
        <SummaryRow
          label="Reference #"
          value={po.referenceNumber ?? <span className="text-faint">—</span>}
        />
        <SummaryRow label="PO Type" value={po.poType} />
        <SummaryRow label="Warehouse" value={po.warehouseLabel} />
        <div className="my-1 h-px bg-border" />
        <SummaryRow label="Created" value={formatDateTime(po.createdAt)} />
        <SummaryRow label="Expected Date" value={formatDate(po.expectedDate)} />
        <SummaryRow
          label="Received At"
          value={po.receivedAt ? formatDateTime(po.receivedAt) : <span className="text-faint">—</span>}
        />
        <div className="my-1 h-px bg-border" />
        <SummaryRow label="Total Quantity" value={formatNumber(po.totalQuantity)} />
        <SummaryRow label="Received" value={formatNumber(po.receivedQuantity)} />
        <SummaryRow label="Line Value" value={formatMoney(lineValue)} />
        <SummaryRow
          label="Purchase Price"
          value={
            <span className="text-[14px] font-semibold text-foreground">
              {formatMoney(po.purchasePrice)}
            </span>
          }
        />
      </Card>
    </div>
  );
}

export function PoDetail({ po, lines }: PoDetailProps) {
  const lineValue = lines.reduce((sum, l) => sum + l.orderedQuantity * l.unitCost, 0);
  return (
    <div className="ks-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 pb-6 pt-3">
        <Breadcrumbs
          items={[
            { label: "PO & Receiving", href: "/receiving" },
            { label: "Purchase Orders", href: "/receiving" },
            { label: po.code },
          ]}
        />
        <div className="mt-1.5 flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{po.code}</h1>
          <StatusPill status={po.status} />
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-secondary">
            {po.poType}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-faint">
          {po.vendorName} · {po.clientName}
        </p>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ProgressHero po={po} lineCount={lines.length} />
            <LinesTable lines={lines} />
          </div>
          <SummaryRail po={po} lineValue={lineValue} />
        </div>
      </div>
    </div>
  );
}
