"use client";

/**
 * Billing report details (`/billing/reports/[id]`): header strip (bill number with pencil →
 * Edit info, statuses, client, warehouse, period, total), Approve / Cancel / Print /
 * Delete, and tabs Consolidated (per fee and tier) · Detailed (grid with search, filters,
 * sort and export; references link to their PO / SO / RMA / work order).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, History, MoreHorizontal, Pencil, Printer, Trash2 } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { urlParam, useUrlState } from "@/lib/use-url-state";
import { BILLING_LINE_FIELDS, BILLING_LINES_GRID_KEY } from "@/lib/grid-defs/organization/billing-reports";
import { DataGrid, GridToolbar, useGrid, type GridColumnDef } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { UnderlineTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { EntityChangeLogDrawer, NO_PERMISSION, toastBulk, toFilterFields, useAction, usePagePerms, type BulkResponse } from "@/components/facility/facility-shared";
import type { ReportDetail } from "@/server/repositories/billing-reports";
import { BillInfoDialog } from "./bill-info-dialog";
import { BillingPill, FREQUENCY_LABELS, moneyGrid, moneyRail, printBill } from "./billing-shared";

interface LineRow {
  readonly id: string;
  readonly feeName: string;
  readonly operationType: string;
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly sku: string | null;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly totalPrice: number;
  readonly minMaxAdjustment: number;
  readonly adjustedPrice: number;
  readonly activityDate: string | null;
  readonly referenceNumber: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
  readonly billingFrequency: string;
}

/** SO000123 → order search, PO000045 → PO search, RMA… → returns, WO… → work orders. */
function refHref(ref: string | null, op: string): string | null {
  if (!ref) return null;
  const q = encodeURIComponent(ref);
  if (/^SO/i.test(ref)) return `/orders?q=${q}&qm=eq`;
  if (/^PO/i.test(ref)) return `/purchase-orders?q=${q}&qm=eq`;
  if (/^RMA/i.test(ref) || op === "Return") return `/returns?q=${q}&qm=eq`;
  if (/^WO/i.test(ref) || op === "Work Order") return `/work-orders?q=${q}&qm=eq`;
  return null;
}

const num = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const LINE_COLUMNS: GridColumnDef<LineRow>[] = [
  { id: "feeName", header: "Fee name", size: 200, meta: { alwaysVisible: true }, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.feeName}</span> },
  { id: "operationType", header: "Operation type", size: 130, cell: ({ row }) => row.original.operationType },
  { id: "activityDate", header: "Activity date", size: 120, cell: ({ row }) => <span className="tabular-nums">{row.original.activityDate ?? "—"}</span> },
  { id: "referenceNumber", header: "Reference number", size: 160, cell: ({ row }) => { const href = refHref(row.original.referenceNumber, row.original.operationType); return href ? <Link className="font-mono text-primary hover:underline" href={href} onClick={(e) => e.stopPropagation()}>{row.original.referenceNumber}</Link> : <span className="font-mono">{row.original.referenceNumber ?? "—"}</span>; } },
  { id: "sku", header: "SKU", size: 150, cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.sku ?? "—"}</span> },
  { id: "lpNumber", header: "LP / tracking", size: 150, cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.lpNumber ?? "—"}</span> },
  { id: "chargeBy", header: "Charge by", size: 150, enableSorting: false, cell: ({ row }) => row.original.chargeBy },
  { id: "quantity", header: "Quantity", size: 100, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{num(row.original.quantity, row.original.quantity % 1 ? 2 : 0)}</div> },
  { id: "unitPrice", header: "Unit price", size: 110, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{num(row.original.unitPrice, 4)}</div> },
  { id: "totalPrice", header: "Total price", size: 120, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{num(row.original.totalPrice)}</div> },
  { id: "adjustedPrice", header: "Adjusted price", size: 130, meta: { align: "right" }, cell: ({ row }) => <div className="text-right font-semibold tabular-nums">{num(row.original.adjustedPrice)}</div> },
  { id: "note", header: "Note", size: 200, enableSorting: false, meta: { defaultVisible: false }, cell: ({ row }) => row.original.note ?? "" },
];

function Detailed({ id }: { readonly id: string }) {
  const fields = React.useMemo(() => toFilterFields(BILLING_LINE_FIELDS), []);
  const g = useGrid<LineRow>({ gridKey: BILLING_LINES_GRID_KEY, path: `/api/billing-reports/${id}/lines`, fields });
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-[420px] flex-col rounded-lg border border-border bg-surface">
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search reference, SKU, fee or LP" />
      <DataGrid<LineRow> {...g.gridProps} columns={LINE_COLUMNS} getRowId={(r) => r.id}
        emptyTitle={filtered ? "No lines match these filters" : "No detailed lines"} emptyDescription={filtered ? "Clear a filter or search for another reference." : "This bill had no billable activity in its period."} />
    </div>
  );
}

const TABS = ["consolidated", "detailed"] as const;

export function BillingReportDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const perms = usePagePerms("settings.billing_report", ["view", "delete", "approve", "cancel"] as const);
  const [url, setUrl] = useUrlState({ tab: urlParam.enum(TABS, "consolidated") });
  const q = useApiQuery<ReportDetail>(["billing-report", id], `/api/billing-reports/${id}`, { staleTime: 0 });
  const [info, setInfo] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"approve" | "cancel" | "delete" | null>(null);
  const action = useAction([["billing-report", id], ["grid", "billing-reports"]]);
  const b = q.data?.data;
  if (q.isPending) return <div className="flex flex-col gap-4 p-6"><Skeleton className="h-28 w-full" /><Skeleton className="h-80 w-full" /></div>;
  if (q.isError || !b) {
    const missing = isApiError(q.error) && q.error.code === "NOT_FOUND";
    return <div className="p-6"><EmptyState title={missing ? "Bill not found" : "Couldn't load this bill"} description={missing ? "It may have been deleted, or it's outside your scope." : q.error?.message} action={missing ? <Button onClick={() => router.push("/billing/reports")}>Back to Billing Report</Button> : <Button onClick={() => void q.refetch()}>Retry</Button>} /></div>;
  }
  const print = async () => {
    try {
      const { data } = await apiRequest<readonly LineRow[]>(`/api/billing-reports/${id}/lines?ps=1000`, { method: "GET" });
      printBill(b, data);
    } catch {
      toast.error("Couldn't prepare the printout", "Try again in a moment.");
    }
  };
  const byFee = new Map<string, number>();
  for (const l of b.consolidated) byFee.set(l.feeName, (byFee.get(l.feeName) ?? 0) + l.adjustedPrice);
  const adjustments = b.consolidated.reduce((n, l) => n + l.minMaxAdjustment, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Billing report details" crumbLabel={b.billNumber} />
      <div className="flex flex-col gap-5 px-6 pb-10">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs" aria-label="Bill header">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-[20px] font-semibold text-foreground">Bill {b.billNumber}</h1>
                <DisabledReason reason={!perms.approve ? NO_PERMISSION : b.billStatus === "Canceled" ? "Canceled bills are final" : null}><Button size="icon-sm" variant="ghost" aria-label="Edit info" disabled={!perms.approve || b.billStatus === "Canceled"} onClick={() => setInfo(true)}><Pencil className="h-4 w-4" /></Button></DisabledReason>
                <BillingPill status={b.billStatus} />
                <BillingPill status={b.calcStatus} />
              </div>
              <p className="mt-0.5 text-[13px] text-secondary"><Link className="text-primary hover:underline" href={`/billing/${b.contractId}`}>{b.contractName}</Link> · {b.clientName} · {b.warehouseCode}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setLog(true)}><History className="h-4 w-4" />Change log</Button>
              <Button onClick={() => void print()}><Printer className="h-4 w-4" />Print</Button>
              {b.billStatus === "Draft" ? <DisabledReason reason={!perms.approve ? NO_PERMISSION : b.calcStatus === "Failed" ? "Failed calculations can't be approved" : null}><Button variant="primary" disabled={!perms.approve || b.calcStatus === "Failed"} onClick={() => setConfirm("approve")}><CheckCircle2 className="h-4 w-4" />Approve</Button></DisabledReason> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem icon={Ban} onSelect={() => setConfirm("cancel")} disabledReason={!perms.cancel ? NO_PERMISSION : b.billStatus === "Canceled" ? "Already canceled" : null}>Cancel bill</DropdownMenuItem>
                  <DropdownMenuItem icon={Trash2} destructive onSelect={() => setConfirm("delete")} disabledReason={!perms.delete ? NO_PERMISSION : b.billStatus !== "Draft" ? `${b.billStatus} bills can't be deleted` : null}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-[13px] md:grid-cols-3 lg:grid-cols-6">
            {[
              ["Period", `${b.periodStart.slice(0, 10)} – ${b.periodEnd.slice(0, 10)}`], ["Billing frequency", FREQUENCY_LABELS[b.frequency] ?? b.frequency],
              ["Calculated", new Date(b.calculatedAt).toLocaleString("en-US")], ["Created by", b.createdByName ?? "Scheduler"], ["Detailed lines", b.detailCount.toLocaleString("en-US")],
            ].map(([k, v]) => <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">{k}</dt><dd className="mt-0.5 tabular-nums text-foreground">{v}</dd></div>)}
            <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">Total</dt><dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-foreground">{moneyRail(b.totalPrice, b.currency)}</dd></div>
          </dl>
        </section>
        {b.calcStatus === "Failed" ? <Callout variant="error" title="This calculation failed">{b.errorMessage ?? "The engine couldn't price this period."} Fix the billing form, then calculate again.</Callout> : null}
        <UnderlineTabs tabs={[{ key: "consolidated", label: "Consolidated", count: b.consolidated.length }, { key: "detailed", label: "Detailed", count: b.detailCount }]} active={url.tab} onChange={(k) => setUrl({ tab: k as (typeof TABS)[number] })} className="px-0" ariaLabel="Bill lines" />
        {url.tab === "consolidated" ? (
          b.consolidated.length === 0 ? <EmptyState title="No consolidated lines" description="Nothing was billable in this period." /> : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-surface-sunken text-[11px] font-semibold uppercase tracking-wide text-secondary">
                  <tr>{["Fee name", "Operation", "Fee by", "Charge by", "Tier", "Quantity", "Unit price", "Total price", "Min/max adj.", "Adjusted price"].map((h, i) => <th key={h} className={i >= 4 ? "px-3 py-2 text-right" : "px-3 py-2"}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.consolidated.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-sunken/40">
                      <td className="px-3 py-2 font-medium text-foreground">{l.feeName}</td><td className="px-3 py-2">{l.operationType}</td><td className="px-3 py-2">{l.feeBy}</td><td className="px-3 py-2">{l.chargeBy}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.fromQty !== null ? `${l.fromQty}–${l.toQty ?? "∞"}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(l.quantity, l.quantity % 1 ? 2 : 0)}</td><td className="px-3 py-2 text-right tabular-nums">{num(l.unitPrice, 4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(l.totalPrice)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.minMaxAdjustment ? "text-warning" : "text-faint"}`}>{l.minMaxAdjustment ? num(l.minMaxAdjustment) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{moneyGrid(l.adjustedPrice, b.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-sunken/60 text-[13px]">
                  <tr><td className="px-3 py-2 font-semibold" colSpan={8}>{byFee.size} fees{adjustments ? ` · min/max adjustments ${num(adjustments)}` : ""}</td><td /><td className="px-3 py-2 text-right text-[15px] font-semibold tabular-nums">{moneyGrid(b.totalPrice, b.currency)}</td></tr>
                </tfoot>
              </table>
            </div>
          )
        ) : <Detailed id={b.id} />}
      </div>
      <BillInfoDialog bill={info ? b : null} onOpenChange={(o) => !o && setInfo(false)} onSaved={() => void q.refetch()} />
      <EntityChangeLogDrawer open={log} onOpenChange={setLog} path={`/api/billing-reports/${b.id}/change-log`} title={`Change log · ${b.billNumber}`} />
      <ConfirmDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} variant={confirm === "approve" ? "info" : confirm === "cancel" ? "attention" : "danger"}
        title={confirm === "approve" ? `Approve bill ${b.billNumber}?` : confirm === "cancel" ? `Cancel bill ${b.billNumber}?` : `Delete bill ${b.billNumber}?`}
        description={confirm === "approve" ? "Approved bills can't be deleted and lock their period's VAS operations." : confirm === "cancel" ? "Canceled bills are final; calculate the period again to replace it." : "The draft bill and its lines are removed."}
        confirmLabel="Yes" cancelLabel="No"
        onConfirm={async () => {
          const path = confirm === "approve" ? "/api/billing-reports/approve" : confirm === "cancel" ? "/api/billing-reports/cancel" : "/api/billing-reports/bulk-delete";
          const r = await action.run<BulkResponse>(path, "POST", { ids: [b.id] });
          if (r) { toastBulk(r, "bill", confirm === "approve" ? "approved" : confirm === "cancel" ? "canceled" : "deleted"); if (confirm === "delete" && r.succeeded.length) router.push("/billing/reports"); }
          setConfirm(null);
        }} />
    </div>
  );
}
