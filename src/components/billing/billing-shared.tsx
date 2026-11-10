"use client";

/**
 * Shared client pieces for 3PL Billing (M11): approval / bill status pills, active-client
 * and VAS-type options, money formatting, the Calculate modal and the printable HTML
 * documents (contract summary and bill) opened in a new window.
 */
import * as React from "react";
import Link from "next/link";
import { Calculator, CheckCircle2, XCircle } from "lucide-react";
import { z } from "zod";
import { useApiQuery } from "@/lib/query-client";
import { moneyGrid, moneyRail } from "@/lib/grid-defs/organization/common";
import { conditionText } from "@/lib/grid-defs/organization/billing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { RadioCards } from "@/components/ui/radio-cards";
import { toast } from "@/components/ui/toast";
import { useAction, type BulkResponse } from "@/components/facility/facility-shared";
import type { ContractDetail } from "@/server/repositories/billing";
import type { ReportDetail } from "@/server/repositories/billing-reports";

export { moneyGrid, moneyRail };

const PILL: Readonly<Record<string, string>> = {
  Draft: "bg-[#E3E6E8] text-[#50575C]",
  Approved: "bg-[#D3F0E3] text-[#17874D]",
  Canceled: "bg-[#FBDBDE] text-[#B20B1C]",
  Successful: "bg-[#D3F0E3] text-[#17874D]",
  Failed: "bg-[#FBDBDE] text-[#B20B1C]",
};

export function BillingPill({ status, className }: { readonly status: string; readonly className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", PILL[status] ?? PILL.Draft, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{status}
    </span>
  );
}

const optionRow = z.object({ id: z.string(), name: z.string(), code: z.string(), status: z.string(), currency: z.string().optional() });

/** Active clients (Inactive ones can't get new billing forms or VAS operations). */
export function useActiveClients(): { readonly options: readonly { value: string; label: string }[]; readonly currencyOf: (id: string) => string; readonly loading: boolean } {
  const q = useApiQuery<unknown>(["billing-active-clients"], "/api/clients", { query: { "f.status": "in:Active", ps: 1000, sort: "name" } });
  const rows = z.array(optionRow).safeParse(q.data?.data);
  const list = rows.success ? rows.data : [];
  return {
    options: list.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
    currencyOf: (id) => list.find((c) => c.id === id)?.currency ?? "USD",
    loading: q.isPending,
  };
}

const vasTypeRow = z.object({ id: z.string(), name: z.string(), calculationType: z.enum(["Total Price", "Vas Quantity"]), clientId: z.string().nullable(), isActive: z.boolean() });
export type VasTypeOption = z.infer<typeof vasTypeRow>;

export function useVasTypes(): { readonly rows: readonly VasTypeOption[]; readonly loading: boolean } {
  const q = useApiQuery<unknown>(["vas-types"], "/api/vas-operations/vas-types", { staleTime: 60_000 });
  const parsed = z.array(vasTypeRow).safeParse(q.data?.data);
  return { rows: parsed.success ? parsed.data : [], loading: q.isPending };
}

export const FREQUENCY_LABELS: Readonly<Record<string, string>> = { Monthly: "Monthly", Weekly: "Weekly", Daily: "Daily", BiMonthly: "Every 2 months", SemiMonthly: "Twice a month", BiWeekly: "Every 2 weeks" };

/* ---------------- Calculate ---------------- */

type Mode = "lastClosed" | "current" | "custom";

interface CalcReport { readonly contractId: string; readonly reportId: string; readonly billNumber: string; readonly status: "Successful" | "Failed"; readonly totalPrice: number; readonly errorMessage: string | null }

export function CalculateDialog({ open, onOpenChange, contracts, onDone }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly contracts: readonly { id: string; name: string }[]; readonly onDone?: () => void }) {
  const [mode, setMode] = React.useState<Mode>("lastClosed");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [results, setResults] = React.useState<readonly CalcReport[] | null>(null);
  const action = useAction([["grid", "billing-contracts"], ["grid", "billing-reports"]]);
  React.useEffect(() => { if (open) { setResults(null); } }, [open]);
  const customError = mode === "custom" && (!start || !end) ? "Choose a start and end date" : mode === "custom" && end < start ? "End date must be on or after the start date" : null;
  const run = async () => {
    const out = await action.run<BulkResponse & { reports: readonly CalcReport[] }>("/api/billing/calculate", "POST", { ids: contracts.map((c) => c.id), mode, ...(mode === "custom" ? { start, end } : {}) });
    if (!out) return;
    setResults(out.reports);
    const failed = out.reports.filter((r) => r.status === "Failed").length + out.failed.length;
    if (failed === 0) toast.success("Calculation complete", `${out.reports.length} bill${out.reports.length === 1 ? "" : "s"} created.`);
    else toast.warning("Calculated with problems", `${failed} of ${contracts.length} contracts failed. ${out.failed.map((f) => f.message).join(" · ")}`);
    onDone?.();
  };
  const name = (id: string) => contracts.find((c) => c.id === id)?.name ?? "Contract";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={`Calculate ${contracts.length === 1 ? contracts[0]?.name : `${contracts.length} billing forms`}`} description="Runs the billing engine now and creates one bill per contract in Billing Report." />
        <DialogBody>
          {results ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {results.map((r) => (
                <li key={r.reportId} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  {r.status === "Successful" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <XCircle className="h-4 w-4 text-danger" aria-hidden />}
                  <div className="flex-1">
                    <div className="font-medium text-foreground">{name(r.contractId)}</div>
                    <div className="text-[12px] text-secondary">{r.status === "Successful" ? `Bill ${r.billNumber} · ${moneyRail(r.totalPrice)}` : r.errorMessage ?? "Calculation failed"}</div>
                  </div>
                  <Link className="text-[12px] font-semibold text-primary hover:underline" href={`/billing/reports/${r.reportId}`} onClick={() => onOpenChange(false)}>View bill</Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4">
              <RadioCards<Mode> ariaLabel="Billing period" value={mode} onChange={setMode} options={[
                { value: "lastClosed", title: "Last closed period", description: "The most recent full period before today (what the scheduler bills)." },
                { value: "current", title: "Current period to date", description: "From the start of the open period through today: a preview bill." },
                { value: "custom", title: "Custom date range", description: "Bill any range inside the contract, e.g. a mid-month termination." },
              ]} />
              {mode === "custom" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Start date *<input type="date" className="h-8 rounded-md border border-border-strong/70 bg-surface px-2 text-[13px] text-foreground" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={Boolean(customError && !start)} /></label>
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">End date *<input type="date" className="h-8 rounded-md border border-border-strong/70 bg-surface px-2 text-[13px] text-foreground" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={Boolean(customError && !end)} /></label>
                  {customError ? <p className="col-span-2 text-[12px] text-danger" role="alert">{customError}</p> : null}
                </div>
              ) : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {results ? <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button> : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={action.pending}>Cancel</Button>
              <Button variant="primary" onClick={() => void run()} disabled={Boolean(customError) || action.pending || contracts.length === 0} aria-busy={action.pending}><Calculator className="h-4 w-4" />{action.pending ? "Calculating…" : "Calculate"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- printouts ---------------- */

const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

const PRINT_CSS = `body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#101828;margin:32px;font-size:12px}h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#475467}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 16px;margin-top:16px}.meta div span{display:block;color:#667085;font-size:11px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #EAECF0;vertical-align:top}
th{background:#F9FAFB;font-size:10px;text-transform:uppercase;color:#475467}td.r,th.r{text-align:right}.total{font-size:16px;font-weight:700;text-align:right;margin-top:12px}.muted{color:#667085}@media print{body{margin:12mm}}`;

function openPrint(title: string, body: string): void {
  const w = window.open("", "_blank", "noopener=no,width=960,height=1200");
  if (!w) { toast.error("Pop-up blocked", "Allow pop-ups for KitStaks to print."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}<script>window.onload=function(){window.focus();window.print();}</script></body></html>`);
  w.document.close();
}

export function printContract(c: ContractDetail): void {
  const rows = c.fees.map((f) => `<tr><td><strong>${esc(f.name)}</strong>${f.conditions.length ? `<div class="muted">If ${esc(f.conditions.map((x) => x.text).join(" and "))}</div>` : ""}</td><td>${esc(f.operationType)}${f.calculationType ? `<div class="muted">${esc(f.calculationType)}</div>` : ""}</td><td>${esc(f.feeBy)}</td><td>${esc(f.chargeBy)}</td>
    <td>${f.calculationType === "Split Month Storage" ? `${esc((f.standardRate ?? 0).toFixed(2))} through day ${esc(f.splitDay)}, then ${esc((f.alternateRate ?? 0).toFixed(2))}` : f.tiers.map((t) => `${esc(t.fromQty ?? 1)}–${t.toQty ?? "∞"} @ ${esc(t.rate.toFixed(2))}`).join("<br>")}</td>
    <td class="r">${f.useMinPrice ? esc(moneyGrid(f.minPrice, c.currency)) : "—"}</td><td class="r">${f.useMaxPrice ? esc(moneyGrid(f.maxPrice, c.currency)) : "—"}</td></tr>`).join("");
  openPrint(`Billing form ${c.name}`, `<h1>${esc(c.name)}</h1><div class="muted">3PL billing contract · printed ${esc(new Date().toLocaleString("en-US"))}</div>
    <div class="meta"><div><span>Client</span>${esc(c.clientName)}</div><div><span>Warehouse</span>${esc(c.warehouseCode)}</div><div><span>Calc. start date</span>${esc(c.calcStartDate)}</div><div><span>Billing period</span>${esc(FREQUENCY_LABELS[c.frequency] ?? c.frequency)}</div>
    <div><span>Approval</span>${esc(c.approvalStatus)}</div><div><span>Currency</span>${esc(c.currency)}</div><div><span>Fees</span>${c.fees.length}</div><div><span>Next period</span>${esc(c.nextPeriodStart ?? "—")}</div></div>
    <h2>Fees</h2><table><thead><tr><th>Fee</th><th>Operation</th><th>Fee by</th><th>Charge by</th><th>Price</th><th class="r">Min</th><th class="r">Max</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted">No fees</td></tr>`}</tbody></table>`);
}

export function printBill(b: ReportDetail, detail: readonly { feeName: string; activityDate: string | null; referenceNumber: string | null; sku: string | null; quantity: number; unitPrice: number; adjustedPrice: number }[]): void {
  const cons = b.consolidated.map((l) => `<tr><td>${esc(l.feeName)}</td><td>${esc(l.operationType)}</td><td>${esc(l.chargeBy)}</td><td class="r">${l.fromQty !== null ? `${esc(l.fromQty)}–${l.toQty ?? "∞"}` : ""}</td><td class="r">${esc(l.quantity)}</td><td class="r">${esc(l.unitPrice.toFixed(2))}</td><td class="r">${esc(l.minMaxAdjustment ? l.minMaxAdjustment.toFixed(2) : "")}</td><td class="r">${esc(moneyGrid(l.adjustedPrice, b.currency))}</td></tr>`).join("");
  const det = detail.slice(0, 2000).map((l) => `<tr><td>${esc(l.feeName)}</td><td>${esc(l.activityDate ?? "")}</td><td>${esc(l.referenceNumber ?? "")}</td><td>${esc(l.sku ?? "")}</td><td class="r">${esc(l.quantity)}</td><td class="r">${esc(l.unitPrice.toFixed(2))}</td><td class="r">${esc(l.adjustedPrice.toFixed(2))}</td></tr>`).join("");
  openPrint(`Bill ${b.billNumber}`, `<h1>Bill ${esc(b.billNumber)}</h1><div class="muted">${esc(b.contractName)} · ${esc(b.billStatus)}</div>
    <div class="meta"><div><span>Client</span>${esc(b.clientName)}</div><div><span>Warehouse</span>${esc(b.warehouseCode)}</div><div><span>Period</span>${esc(b.periodStart)} – ${esc(b.periodEnd)}</div><div><span>Calculated</span>${esc(new Date(b.calculatedAt).toLocaleString("en-US"))}</div></div>
    <h2>Consolidated</h2><table><thead><tr><th>Fee</th><th>Operation</th><th>Charge by</th><th class="r">Tier</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Min/max adj.</th><th class="r">Amount</th></tr></thead><tbody>${cons}</tbody></table>
    <div class="total">Total ${esc(moneyRail(b.totalPrice, b.currency))}</div>${det ? `<h2>Detail</h2><table><thead><tr><th>Fee</th><th>Date</th><th>Reference</th><th>SKU</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>${det}</tbody></table>` : ""}`);
}

export function conditionLine(c: { field: string; comparator: string; value: unknown }): string {
  return conditionText(c);
}
