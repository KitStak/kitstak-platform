"use client";

import * as React from "react";
import Link from "next/link";
import {
  Ban,
  CalendarClock,
  ChevronDown,
  FileDown,
  PackageCheck,
  Plus,
  Printer,
  StickyNote,
} from "lucide-react";
import type { PurchaseOrderLineRow } from "@/server/repositories/purchase-orders";
import { Breadcrumbs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
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

type EtaTone = "ok" | "warn" | "overdue" | "muted";

/**
 * Whole calendar days from today until `expectedDate` (negative = past due).
 * Compares at day granularity in the viewer's local calendar, so a PO expected
 * yesterday is "overdue" all day today — never "due today" just because fewer
 * than 24 clock-hours have elapsed.
 */
function calendarDaysUntil(expectedDate: string): number {
  const expected = new Date(expectedDate);
  if (Number.isNaN(expected.getTime())) return Number.NaN;
  const now = new Date();
  const expectedDay = Date.UTC(expected.getFullYear(), expected.getMonth(), expected.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expectedDay - today) / MS_PER_DAY);
}

function etaLabel(po: PoDetailData): { text: string; tone: EtaTone } {
  if (po.status === "Completed" && po.receivedAt) {
    return { text: `Received ${formatDate(po.receivedAt)}`, tone: "ok" };
  }
  if (po.status === "Cancelled") return { text: "Order cancelled", tone: "muted" };
  if (!po.expectedDate) return { text: "No expected date", tone: "muted" };
  const days = calendarDaysUntil(po.expectedDate);
  if (Number.isNaN(days)) return { text: "No expected date", tone: "muted" };
  if (days > 1) return { text: `Due in ${days} days`, tone: "muted" };
  if (days === 1) return { text: "Due tomorrow", tone: "warn" };
  if (days === 0) return { text: "Due today", tone: "warn" };
  return { text: `Overdue by ${Math.abs(days)} day${days === -1 ? "" : "s"}`, tone: "overdue" };
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
        Receiving progress
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-semibold leading-8 tabular-nums text-foreground">
            {formatNumber(po.receivedQuantity)}
          </span>
          <span className="text-[14px] text-faint">
            / {formatNumber(po.totalQuantity)} units received
          </span>
        </p>
        <div className="flex items-end gap-6">
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
          {/*
            Third KPI column: a "DUE" micro-label in the same 11px uppercase
            style keeps the REMAINING / LINES / DUE cluster reading as a clean
            label-over-value grid instead of a floating pill.
          */}
          <div className="flex flex-col items-end text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
              Due
            </p>
            <span
              className={cn(
                "mt-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold",
                eta.tone === "ok" && "bg-success-soft text-success",
                eta.tone === "warn" && "bg-warning-soft text-warning",
                eta.tone === "overdue" && "border border-danger/30 bg-danger-soft text-danger",
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
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-soft"
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
        {/* leading-none keeps the % label optically centered on the 8px track */}
        <span className="shrink-0 text-[12px] font-semibold leading-none tabular-nums text-body">
          {pct}%
        </span>
      </div>
    </Card>
  );
}

const thClass =
  "whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint";
const numTd = "px-4 text-right text-[13px] tabular-nums text-body";

type LineStatus = "open" | "partial" | "complete";

const LINE_STATUS_STYLES: Record<LineStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-neutral-soft text-neutral" },
  partial: { label: "Partial", className: "bg-warning-soft text-warning" },
  complete: { label: "Complete", className: "bg-success-soft text-success" },
};

function lineStatus(ordered: number, received: number): LineStatus {
  if (received <= 0) return "open";
  if (received >= ordered) return "complete";
  return "partial";
}

/** Per-line fulfillment pill: grey before receiving starts, amber while units remain, green once complete. */
function LineStatusPill({ ordered, received }: { ordered: number; received: number }) {
  const status = LINE_STATUS_STYLES[lineStatus(ordered, received)];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4",
        status.className
      )}
    >
      {status.label}
    </span>
  );
}

function LineRow({ line }: { line: PurchaseOrderLineRow }) {
  const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity);
  return (
    <tr className="group h-10 border-t border-border transition-colors hover:bg-surface-sunken">
      <td className="truncate px-4">
        <Link
          href={`/products/${line.productId}`}
          className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {line.sku}
        </Link>
      </td>
      {/*
        CSS truncation (table-fixed flexible column + `truncate`) renders a
        true "…" flush to the text; `title` exposes the full name on hover.
        Never slice the string by hand — that produces the " ..." artifact.
      */}
      <td className="max-w-0 truncate px-4 text-body" title={line.productName}>
        {line.productName}
      </td>
      <td className={numTd}>{formatNumber(line.orderedQuantity)}</td>
      <td className={numTd}>{formatNumber(line.receivedQuantity)}</td>
      <td className="px-4 text-center">
        <LineStatusPill ordered={line.orderedQuantity} received={line.receivedQuantity} />
      </td>
      <td className={cn(numTd, remaining > 0 ? "font-medium text-warning" : "text-faint")}>
        {remaining > 0 ? formatNumber(remaining) : "—"}
      </td>
      <td className={numTd}>{formatMoney(line.unitCost)}</td>
      <td className={cn(numTd, "font-medium text-foreground")}>
        {formatMoney(line.orderedQuantity * line.unitCost)}
      </td>
      <td className="pl-2 pr-6 text-right">
        <button
          type="button"
          className="rounded text-[12px] font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none disabled:cursor-default disabled:text-faint disabled:no-underline"
          disabled={remaining === 0}
          aria-label={`Receive units for ${line.sku}`}
        >
          Receive
        </button>
      </td>
    </tr>
  );
}

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
        {/* min-w 940 (was 900): the flexible PRODUCT column gains ~40px so
            full seeded names ("NovaForge USB-C Cable 3m — Braided") fit
            without truncating at typical widths. */}
        <table className="w-full min-w-[940px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[170px]" />
            <col />
            <col className="w-[84px]" />
            <col className="w-[88px]" />
            <col className="w-[96px]" />
            <col className="w-[96px]" />
            <col className="w-[92px]" />
            <col className="w-[108px]" />
            <col className="w-[90px]" />
          </colgroup>
          <thead className="bg-surface shadow-[inset_0_-1px_0_var(--border)]">
            <tr>
              <th className={thClass}>SKU</th>
              <th className={thClass}>Product</th>
              <th className={cn(thClass, "text-right")}>Ordered</th>
              <th className={cn(thClass, "text-right")}>Received</th>
              <th className={cn(thClass, "text-center")}>Status</th>
              <th className={cn(thClass, "text-right")}>Remaining</th>
              <th className={cn(thClass, "text-right")}>Unit Cost</th>
              <th className={cn(thClass, "text-right")}>Line Total</th>
              <th className={cn(thClass, "pl-2 pr-6 text-right")}>
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
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
              <td />
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatNumber(Math.max(0, totals.ordered - totals.received))}
              </td>
              <td />
              <td className={cn(numTd, "font-semibold text-foreground")}>
                {formatMoney(totals.value)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

interface ReceiptRow {
  id: string;
  number: string;
  date: string;
  receivedBy: string;
  lineCount: number;
  units: number;
  status: string;
}

const RECEIVERS = ["M. Alvarez", "D. Chen", "R. Okafor"] as const;

/** Deterministic receiving history derived from the PO's received totals. */
function buildReceiptHistory(po: PoDetailData, totalLines: number): ReceiptRow[] {
  if (po.receivedQuantity <= 0) return [];
  const poNumber = po.code.replace(/^PO-/, "");
  const first = Math.round(po.receivedQuantity * 0.45);
  const second = Math.round(po.receivedQuantity * 0.34);
  const third = po.receivedQuantity - first - second;
  const unitSplits = [first, second, third].filter((units) => units > 0);
  const createdMs = new Date(po.createdAt).getTime();
  return unitSplits.map((units, index) => ({
    id: `rcv-${index}`,
    number: `RCV-${poNumber}-0${index + 1}`,
    date: new Date(createdMs + (index + 1) * 2 * MS_PER_DAY).toISOString(),
    receivedBy: RECEIVERS[index % RECEIVERS.length] ?? "Receiving Team",
    lineCount: Math.max(1, totalLines - index),
    units,
    status:
      index === unitSplits.length - 1 && po.status === "Receiving" ? "In Progress" : "Completed",
  }));
}

interface ActivityEvent {
  id: string;
  label: string;
  detail: string;
  at: string;
}

function buildActivity(po: PoDetailData, receipts: ReceiptRow[]): ActivityEvent[] {
  const created: ActivityEvent = {
    id: "created",
    label: "Purchase order created",
    detail: `${po.code} entered for ${po.vendorName}`,
    at: po.createdAt,
  };
  const receiptEvents = receipts.map((receipt) => ({
    id: receipt.id,
    label: `Receipt ${receipt.number} posted`,
    detail: `${formatNumber(receipt.units)} units across ${receipt.lineCount} line${
      receipt.lineCount === 1 ? "" : "s"
    } · ${receipt.receivedBy}`,
    at: receipt.date,
  }));
  return [created, ...receiptEvents].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

const receiptThClass = cn(thClass, "bg-surface");

function ReceiptsTable({ receipts }: { receipts: ReceiptRow[] }) {
  if (receipts.length === 0) {
    return (
      <HistoryEmptyState
        icon={<PackageCheck className="h-5 w-5" aria-hidden />}
        title="No receipts yet"
        description="Receipts will appear here as soon as units are received against this order."
      />
    );
  }
  return (
    <div className="ks-scroll overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead className="shadow-[inset_0_-1px_0_var(--border)]">
          <tr>
            <th className={receiptThClass}>Receipt #</th>
            <th className={receiptThClass}>Date</th>
            <th className={receiptThClass}>Received By</th>
            <th className={cn(receiptThClass, "text-right")}>Lines</th>
            <th className={cn(receiptThClass, "text-right")}>Units</th>
            <th className={receiptThClass}>Status</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => (
            <tr
              key={receipt.id}
              className="h-10 border-t border-border transition-colors hover:bg-surface-sunken"
            >
              <td className="px-4 font-medium text-primary">{receipt.number}</td>
              <td className="px-4 text-body">{formatDate(receipt.date)}</td>
              <td className="px-4 text-body">{receipt.receivedBy}</td>
              <td className={numTd}>{formatNumber(receipt.lineCount)}</td>
              <td className={cn(numTd, "font-medium text-foreground")}>
                {formatNumber(receipt.units)}
              </td>
              <td className="px-4">
                <StatusPill status={receipt.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityList({ events }: { events: ActivityEvent[] }) {
  return (
    <ul className="px-5 py-3">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-4 last:pb-1">
          {index < events.length - 1 ? (
            <span
              className="absolute left-[5px] top-4 h-full w-px bg-border"
              aria-hidden
            />
          ) : null}
          <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-primary bg-surface" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">{event.label}</p>
            <p className="mt-0.5 text-[12px] text-faint">
              {event.detail} · {formatDateTime(event.at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HistoryEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-soft text-neutral">
        {icon}
      </span>
      <p className="mt-3 text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-[340px] text-[12px] leading-4 text-faint">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

const HISTORY_TABS = [
  { key: "receipts", label: "Receipts" },
  { key: "activity", label: "Activity" },
  { key: "notes", label: "Notes" },
] as const;

type HistoryTabKey = (typeof HISTORY_TABS)[number]["key"];

function ReceivingHistory({ po, lineCount }: { po: PoDetailData; lineCount: number }) {
  const [activeTab, setActiveTab] = React.useState<HistoryTabKey>("receipts");
  const receipts = React.useMemo(() => buildReceiptHistory(po, lineCount), [po, lineCount]);
  const events = React.useMemo(() => buildActivity(po, receipts), [po, receipts]);
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-1 border-b border-border px-3"
        role="tablist"
        aria-label="Receiving history"
      >
        {HISTORY_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-faint hover:text-body"
              )}
            >
              {tab.label}
              {tab.key === "receipts" ? (
                <span className="rounded-full bg-neutral-soft px-1.5 text-[11px] font-semibold tabular-nums text-neutral">
                  {receipts.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {activeTab === "receipts" ? <ReceiptsTable receipts={receipts} /> : null}
      {activeTab === "activity" ? <ActivityList events={events} /> : null}
      {activeTab === "notes" ? (
        <HistoryEmptyState
          icon={<StickyNote className="h-5 w-5" aria-hidden />}
          title="No notes on this order"
          description="Keep receiving instructions, discrepancies, and vendor callouts with the PO so the whole team sees them."
          action={
            <Button variant="secondary" size="sm">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add note
            </Button>
          }
        />
      ) : null}
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

function OtherActionsMenu() {
  return (
    <Dropdown
      align="end"
      trigger={(open) => (
        <Button
          variant="ghost"
          size="lg"
          className={cn("shrink-0", open && "bg-neutral-soft text-body")}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Other Actions
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </Button>
      )}
    >
      {(close) => (
        <>
          <DropdownItem onClick={close}>
            <Printer className="h-3.5 w-3.5 text-faint" aria-hidden />
            Print PO
          </DropdownItem>
          <DropdownItem onClick={close}>
            <FileDown className="h-3.5 w-3.5 text-faint" aria-hidden />
            Export PDF
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={close}>
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Cancel PO
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

const VENDOR_CONTACTS = [
  { first: "Sam", last: "Whitaker", role: "Account Manager" },
  { first: "Priya", last: "Natarajan", role: "Fulfillment Coordinator" },
  { first: "Leo", last: "Grant", role: "Sales Operations" },
] as const;

/** "Brightline OEM Group" → "brightlineoem.com" — deterministic fictional domain. */
function vendorDomain(vendorName: string): string {
  const slug = vendorName
    .toLowerCase()
    .replace(/\b(group|inc|llc|co|corp|ltd)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return `${slug.length > 0 ? slug : "vendor"}.com`;
}

/** Deterministic vendor contact details derived from the vendor name. */
function VendorContactCard({ vendorName }: { vendorName: string }) {
  const seed = Array.from(vendorName).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const contact = VENDOR_CONTACTS[seed % VENDOR_CONTACTS.length] ?? VENDOR_CONTACTS[0];
  const email = `${contact.first}.${contact.last}@${vendorDomain(vendorName)}`.toLowerCase();
  const phone = `(312) 555-01${String((seed % 90) + 10)}`;
  return (
    <Card className="py-1.5">
      <p className="px-5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
        Vendor contact
      </p>
      <SummaryRow label="Contact" value={`${contact.first} ${contact.last}`} />
      <SummaryRow label="Role" value={contact.role} />
      <SummaryRow
        label="Email"
        value={
          <a className="text-primary hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        }
      />
      <SummaryRow label="Phone" value={phone} />
      <div className="my-1 h-px bg-border" />
      <SummaryRow label="Payment Terms" value="Net 30" />
      <SummaryRow label="Ship Via" value="LTL Freight" />
    </Card>
  );
}

function SummaryRail({
  po,
  lineValue,
  receivedValue,
}: {
  po: PoDetailData;
  lineValue: number;
  receivedValue: number;
}) {
  const receivable = po.status !== "Completed" && po.status !== "Cancelled";
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-6 lg:w-80 lg:self-start">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="lg" className="min-w-0 flex-1" disabled={!receivable}>
          <PackageCheck className="h-4 w-4" aria-hidden />
          Receive Items
        </Button>
        <OtherActionsMenu />
        <Button
          variant="ghost"
          className="h-9 w-9 shrink-0 p-0"
          aria-label="Print purchase order"
        >
          <Printer className="h-4 w-4" aria-hidden />
        </Button>
      </div>
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
        <SummaryRow label="Received Value" value={formatMoney(receivedValue)} />
        <SummaryRow
          label="Line Value"
          value={
            <span className="text-[14px] font-semibold text-foreground">
              {formatMoney(lineValue)}
            </span>
          }
        />
      </Card>
      <VendorContactCard vendorName={po.vendorName} />
    </div>
  );
}

/** "MLT1 – Main Fulfillment" → "MLT1"; falls back to the full label. */
function warehouseCode(label: string): string {
  const code = label.split(/[–—-]/)[0]?.trim();
  return code && code.length > 0 ? code : label;
}

export function PoDetail({ po, lines }: PoDetailProps) {
  const lineValue = lines.reduce((sum, l) => sum + l.orderedQuantity * l.unitCost, 0);
  const receivedValue = lines.reduce((sum, l) => sum + l.receivedQuantity * l.unitCost, 0);
  return (
    <div className="ks-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 pb-6 pt-3">
        <div className="min-w-0">
          <Breadcrumbs
            items={[
              { label: "Fulfillment", href: "/receiving" },
              { label: "Purchase Orders", href: "/receiving" },
              { label: po.code },
            ]}
          />
          <div className="mt-1.5 flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
              {po.code}
            </h1>
            <StatusPill status={po.status} />
            <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-medium text-neutral">
              {warehouseCode(po.warehouseLabel)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-faint">
            {po.vendorName} · {po.clientName}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ProgressHero po={po} lineCount={lines.length} />
            <LinesTable lines={lines} />
            <ReceivingHistory po={po} lineCount={lines.length} />
          </div>
          <SummaryRail po={po} lineValue={lineValue} receivedValue={receivedValue} />
        </div>
      </div>
    </div>
  );
}
