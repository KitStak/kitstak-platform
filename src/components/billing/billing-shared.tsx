"use client";

/**
 * Shared client pieces for 3PL Billing (M11): approval / bill status pills, active-client
 * and VAS-type options, money formatting, the Calculate modal and the printable HTML
 * documents (contract summary and bill) opened in a new window.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Calculator, CheckCircle2, XCircle } from "lucide-react";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { moneyGrid, moneyRail } from "@/lib/grid-defs/organization/common";
import { conditionText, dayValue, PRICING_MODE_META } from "@/lib/grid-defs/organization/billing";
import { cn } from "@/lib/utils";
import { DEFAULT_FORMAT_PREFERENCES, formatDate, formatGridDateTime, gridDateTimePattern, useFormat } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { RadioCards } from "@/components/ui/radio-cards";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { errorMessage } from "@/components/admin/admin-shared";
import type { BulkResponse } from "@/components/facility/facility-shared";
import type { ContractDetail } from "@/server/repositories/billing";
import type { ReportDetail } from "@/server/repositories/billing-reports";

export { moneyGrid, moneyRail };

const PILL: Readonly<Record<string, string>> = {
  Draft: "bg-neutral-soft text-neutral",
  Approved: "bg-success-soft text-success",
  Canceled: "bg-danger-soft text-danger",
  Successful: "bg-success-soft text-success",
  Failed: "bg-danger-soft text-danger",
  Outdated: "bg-warning-soft text-warning",
};

/**
 * One locale-driven date format across billing (user's date pattern; see lib/format). Dates use the
 * same zero-padded month/day as the grid date-times, so "10/01/2026" sits next to "11/09/2026 11:47 PM".
 */
export function useBillingDates() {
  const f = useFormat();
  return React.useMemo(() => {
    const padded = { ...f.prefs, dateFormat: gridDateTimePattern(f.prefs.dateFormat) };
    const day = (ymd: string | null | undefined) => formatDate(dayValue(ymd), padded);
    return {
      day,
      at: (iso: string | null | undefined) => f.gridDateTime(iso),
      period: (start: string, end: string) => `${day(start)} – ${day(end)}`,
    };
  }, [f]);
}

export function Day({ value }: { readonly value: string | null | undefined }) {
  return <span className="tabular-nums">{useBillingDates().day(value)}</span>;
}

export function At({ value, empty = "Never" }: { readonly value: string | null | undefined; readonly empty?: string }) {
  const d = useBillingDates();
  return value ? <span className="tabular-nums">{d.at(value)}</span> : <span className="text-faint">{empty}</span>;
}

export function BillingPill({ status, className }: { readonly status: string; readonly className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", PILL[status] ?? PILL.Draft, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{status}
    </span>
  );
}

const optionRow = z.object({ id: z.string(), name: z.string(), code: z.string(), status: z.string(), currency: z.string().optional() });

/**
 * Active clients (Inactive ones can't get new billing forms or VAS operations), from the slim
 * `/api/clients/options` endpoint. `emptyText` / `placeholder` tell a loading list apart from an empty one.
 */
export function useActiveClients(): { readonly options: readonly { value: string; label: string }[]; readonly currencyOf: (id: string) => string; readonly loading: boolean; readonly error: string | null; readonly retry: () => void; readonly retrying: boolean; readonly emptyText: string; readonly placeholder: string } {
  // Fail fast (one retry) so a broken endpoint shows an error with Retry instead of "Loading…" forever.
  const q = useApiQuery<unknown>(["billing-active-clients"], "/api/clients/options", { staleTime: 60_000, retry: 1 });
  const rows = z.array(optionRow).safeParse(q.data?.data);
  const list = rows.success ? rows.data : [];
  const failed = q.isError || (q.isSuccess && !rows.success);
  const loading = q.isPending && !failed;
  return {
    options: list.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
    currencyOf: (id) => list.find((c) => c.id === id)?.currency ?? "USD",
    loading,
    error: failed ? "Couldn't load clients." : null,
    retry: () => void q.refetch(),
    retrying: q.isFetching,
    emptyText: loading ? "Loading clients…" : failed ? "Couldn't load clients. Use Retry below the field." : list.length === 0 ? "No active clients. Create one in Organization › Clients." : "No matching client",
    placeholder: loading ? "Loading clients…" : failed ? "Clients unavailable" : "Select a client",
  };
}

/** Inline error + Retry under a picker whose options failed to load (never an endless "Loading…"). */
export function PickerLoadError({ message, onRetry, retrying }: { readonly message: string; readonly onRetry: () => void; readonly retrying?: boolean }) {
  return (
    <p role="alert" className="mt-1 flex items-center gap-2 text-[12px] text-danger">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
      <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-60" onClick={onRetry} disabled={retrying}>{retrying ? "Retrying…" : "Retry"}</button>
    </p>
  );
}

/* ---------------- operation colors ---------------- */

/** Distinct, theme-safe tones per operation type (brand red is reserved for actions; red reads as an error). */
const OP_TONE: Readonly<Record<string, string>> = {
  "Receiving": "bg-sky-500/12 text-sky-700 [[data-theme=dark]_&]:text-sky-300",
  "Storage": "bg-violet-500/12 text-violet-700 [[data-theme=dark]_&]:text-violet-300",
  "Pick & Pack": "bg-amber-500/15 text-amber-800 [[data-theme=dark]_&]:text-amber-300",
  "Shipment": "bg-emerald-500/12 text-emerald-700 [[data-theme=dark]_&]:text-emerald-300",
  "Return": "bg-orange-500/12 text-orange-700 [[data-theme=dark]_&]:text-orange-300",
  "Work Order": "bg-teal-500/12 text-teal-700 [[data-theme=dark]_&]:text-teal-300",
  "VAS": "bg-fuchsia-500/12 text-fuchsia-700 [[data-theme=dark]_&]:text-fuchsia-300",
  "Recurring": "bg-slate-500/15 text-slate-700 [[data-theme=dark]_&]:text-slate-300",
};

export function OperationPill({ operation, className }: { readonly operation: string; readonly className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", OP_TONE[operation] ?? "bg-neutral-soft text-neutral", className)}>{operation}</span>;
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

/** `periodEnd` is the inclusive last day (YYYY-MM-DD). */
export interface CalcReport { readonly contractId: string; readonly reportId: string; readonly billNumber: string; readonly status: "Successful" | "Failed"; readonly totalPrice: number; readonly errorMessage: string | null; readonly periodStart?: string; readonly periodEnd?: string; readonly replaced?: readonly string[] }
interface CalcPreview { readonly contractId: string; readonly contractName: string; readonly periodStart: string; readonly periodEnd: string; readonly today: string; readonly conflicts: readonly { reportId: string; billNumber: string; billStatus: "Draft" | "Approved"; periodStart: string; periodEnd: string }[]; readonly blocked: string | null }

export function CalculateDialog({ open, onOpenChange, contracts, onDone }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly contracts: readonly { id: string; name: string }[]; readonly onDone?: (reports: readonly CalcReport[]) => void }) {
  const [mode, setMode] = React.useState<Mode>("lastClosed");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [results, setResults] = React.useState<readonly CalcReport[] | null>(null);
  const [skipped, setSkipped] = React.useState<readonly { id: string; message: string }[]>([]);
  const [previews, setPreviews] = React.useState<readonly CalcPreview[] | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = React.useState(0);
  const [replace, setReplace] = React.useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const dates = useBillingDates();
  const [pending, setPending] = React.useState(false);
  const action = { pending };
  React.useEffect(() => { if (open) { setResults(null); setSkipped([]); setReplace(false); } }, [open]);
  const customError = mode === "custom" && (!start || !end) ? "Choose a start and end date" : mode === "custom" && end < start ? "End date must be on or after the start date" : null;
  const ids = contracts.map((c) => c.id).join(",");
  // Dry run: the exact range each contract would bill, plus bills that already cover it.
  React.useEffect(() => {
    if (!open || results || customError || !ids) { setPreviews(null); setPreviewError(null); return; }
    let live = true;
    setPreviewing(true);
    setPreviewError(null);
    const t = setTimeout(() => {
      // Read-only endpoint: opening the dialog can never write a bill.
      apiRequest<{ previews?: readonly CalcPreview[] }>("/api/billing/calculate/preview", { method: "POST", body: { ids: ids.split(","), mode, ...(mode === "custom" ? { start, end } : {}) } })
        .then(({ data }) => {
          if (!live) return;
          if (!Array.isArray(data.previews)) { setPreviews(null); setPreviewError("The period preview returned an unexpected response."); return; }
          setPreviews(data.previews);
        })
        .catch((error: unknown) => { if (live) { setPreviews(null); setPreviewError(errorMessage(error)); } })
        .finally(() => { if (live) setPreviewing(false); });
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [open, mode, start, end, ids, customError, results, previewNonce]);
  const runnable = (previews ?? []).filter((p) => !p.blocked);
  const drafts = runnable.filter((p) => p.conflicts.some((c) => c.billStatus === "Draft"));
  const needsConfirm = drafts.length > 0 && !replace;
  const run = async () => {
    if (pending) return;
    const targets = previews ? runnable.map((p) => p.contractId) : contracts.map((c) => c.id);
    if (targets.length === 0) return;
    setPending(true);
    let out: (BulkResponse & { reports: readonly CalcReport[] }) | null = null;
    try {
      out = (await apiRequest<BulkResponse & { reports: readonly CalcReport[] }>("/api/billing/calculate", { method: "POST", body: { ids: targets, mode, replaceDrafts: replace, ...(mode === "custom" ? { start, end } : {}) } })).data;
    } catch (error) {
      toast.error("Couldn't calculate", errorMessage(error));
    } finally {
      setPending(false);
    }
    if (!out) return;
    setResults(out.reports);
    setSkipped([...(previews ?? []).filter((p) => p.blocked).map((p) => ({ id: p.contractId, message: p.blocked ?? "" })), ...out.failed.map((f) => ({ id: f.id, message: f.message }))]);
    // Results show immediately; dependent queries refresh in the background (never block the dialog on them).
    for (const queryKey of [["grid", "billing-contracts"], ["grid", "billing-reports"], ["billing-contract"], ["billing-contract-bills"], ["billing-report"]]) void qc.invalidateQueries({ queryKey });
    const failed = out.reports.filter((r) => r.status === "Failed").length + out.failed.length;
    const only = out.reports.length === 1 ? out.reports[0] : undefined;
    const view = only ? { label: "View bill", onClick: () => { onOpenChange(false); router.push(`/billing/reports/${only.reportId}`); } } : undefined;
    if (failed === 0) toast.success("Calculation complete", only ? `Bill ${only.billNumber} created · ${moneyRail(only.totalPrice)}` : `${out.reports.length} bills created.`, { action: view, duration: 10_000 });
    else toast.warning("Calculated with problems", `${failed} of ${contracts.length} contracts failed. ${[...out.reports.filter((r) => r.status === "Failed").map((r) => r.errorMessage ?? "Calculation failed"), ...out.failed.map((f) => f.message)].join(" · ")}`, { action: view, duration: 10_000 });
    onDone?.(out.reports);
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
                    <div className="text-[12px] text-secondary">{r.status === "Successful" ? `Bill ${r.billNumber} · ${moneyRail(r.totalPrice)}` : r.errorMessage ?? "Calculation failed"}{r.periodStart && r.periodEnd ? ` · ${dates.period(r.periodStart, r.periodEnd)}` : ""}</div>
                    {r.replaced?.length ? <div className="text-[12px] text-warning">Replaced draft bill {r.replaced.join(", ")} (now canceled)</div> : null}
                  </div>
                  <Link className="text-[12px] font-semibold text-primary hover:underline" href={`/billing/reports/${r.reportId}`} onClick={() => onOpenChange(false)}>View bill</Link>
                </li>
              ))}
              {skipped.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <Ban className="h-4 w-4 text-faint" aria-hidden />
                  <div className="flex-1"><div className="font-medium text-foreground">{name(s.id)}</div><div className="text-[12px] text-secondary">Skipped: {s.message}</div></div>
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
              {customError ? null : (
                <section aria-label="Billing period preview" aria-busy={previewing} className="rounded-lg border border-border bg-surface-sunken/40">
                  <h3 className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                    Bills this range {previewing ? <Spinner className="h-3.5 w-3.5" label="Checking the period" /> : null}
                    {previews?.[0] ? <span className="ml-auto font-normal normal-case tracking-normal text-faint">Warehouse time · today {dates.day(previews[0].today)}</span> : null}
                  </h3>
                  {!previews ? (previewError && !previewing ? (
                    <div role="alert" className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-danger">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="flex-1">Couldn&apos;t check the period: {previewError}</span>
                      <Button size="sm" variant="secondary" onClick={() => setPreviewNonce((n) => n + 1)}>Retry</Button>
                    </div>
                  ) : <p className="px-3 py-2.5 text-[12px] text-faint">Checking each contract&apos;s period…</p>) : (
                    <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
                      {previews.map((p) => {
                        const draft = p.conflicts.filter((c) => c.billStatus === "Draft");
                        return (
                          <li key={p.contractId} className="flex flex-col gap-0.5 px-3 py-2 text-[13px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium text-foreground">{p.contractName}</span>
                              <span className="shrink-0 tabular-nums text-foreground">{dates.period(p.periodStart, p.periodEnd)}</span>
                            </div>
                            {p.blocked ? <p className="flex items-start gap-1.5 text-[12px] text-danger"><Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{p.blocked}</p>
                              : draft.length ? <p className="flex items-start gap-1.5 text-[12px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Draft bill {draft.map((d) => d.billNumber).join(", ")} already covers {dates.period(draft[0]!.periodStart, draft[0]!.periodEnd)}.</p>
                              : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}
              {drafts.length ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-[13px] text-body">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                  <span><strong className="text-foreground">Replace the existing draft {drafts.length === 1 ? "bill" : "bills"}</strong><br />The draft is recalculated in place: it keeps its bill number, and its lines and total are replaced with the new results, so the client is never billed twice.</span>
                </label>
              ) : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {results ? <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button> : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={action.pending}>Cancel</Button>
              <DisabledReason reason={customError ?? (!previews ? (previewing ? "Checking the period…" : "The period couldn't be checked. Retry the preview first") : runnable.length === 0 ? (previews.length === 1 && previews[0]?.blocked ? previews[0].blocked : "Every selected contract is blocked for this period") : needsConfirm ? "Confirm replacing the draft bill first" : null)}>
                <Button variant="primary" onClick={() => void run()} disabled={Boolean(customError) || action.pending || contracts.length === 0 || previewing || previews === null || runnable.length === 0 || needsConfirm} aria-busy={action.pending}><Calculator className="h-4 w-4" />{action.pending ? "Calculating…" : replace && drafts.length ? "Replace and calculate" : "Calculate"}</Button>
              </DisabledReason>
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

/**
 * Opens the print window synchronously (inside the click, so browsers never block it as a
 * pop-up) with a "Preparing" page, and returns a filler for when the data arrives.
 */
function startPrint(title: string): { fill: (body: string) => void; fail: (message: string) => void } | null {
  const w = window.open("", "_blank", "noopener=no,width=960,height=1200");
  if (!w) { toast.error("Pop-up blocked", "Allow pop-ups for KitStaks to print."); return null; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><p class="muted">Preparing ${esc(title)}…</p></body></html>`);
  w.document.close();
  return {
    fill: (body) => {
      if (w.closed) return;
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}<script>window.onload=function(){window.focus();window.print();}</script></body></html>`);
      w.document.close();
    },
    fail: (message) => { if (!w.closed) w.document.body.innerHTML = `<p>${esc(message)}</p>`; },
  };
}

function openPrint(title: string, body: string): void {
  startPrint(title)?.fill(body);
}

/** Dates on printouts use the same user pattern as the screens (see useBillingDates); the default is the app's padded M/D pattern. */
export interface PrintDates { readonly day: (ymd: string | null | undefined) => string; readonly at: (iso: string | null | undefined) => string }
const DEFAULT_PRINT_DATES: PrintDates = {
  day: (v) => formatDate(dayValue(v), { ...DEFAULT_FORMAT_PREFERENCES, dateFormat: gridDateTimePattern(DEFAULT_FORMAT_PREFERENCES.dateFormat) }),
  at: (v) => formatGridDateTime(v),
};

export function printContract(c: ContractDetail, dates: PrintDates = DEFAULT_PRINT_DATES): void {
  const printDay = dates.day;
  const rows = c.fees.map((f) => `<tr><td><strong>${esc(f.name)}</strong>${f.conditions.length ? `<div class="muted">If ${esc(f.conditions.map((x) => x.text).join(" and "))}</div>` : ""}</td><td>${esc(f.operationType)}${f.calculationType ? `<div class="muted">${esc(f.calculationType)}</div>` : ""}</td><td>${esc(f.feeBy)}</td><td>${esc(f.chargeBy)}</td>
    <td>${f.calculationType === "Split Month Storage" ? `${esc((f.standardRate ?? 0).toFixed(2))} through day ${esc(f.splitDay)}, then ${esc((f.alternateRate ?? 0).toFixed(2))}` : `<div class="muted">${esc(PRICING_MODE_META[f.pricingMode ?? "graduated"].title)}${f.chargeOneTime ? " · one time" : ""}</div>${f.tiers.map((t) => `${esc(t.fromQty ?? 1)}–${t.toQty ?? "∞"} @ ${esc(t.rate.toFixed(2))}`).join("<br>")}`}</td>
    <td class="r">${f.useMinPrice ? esc(moneyGrid(f.minPrice, c.currency)) : "—"}</td><td class="r">${f.useMaxPrice ? esc(moneyGrid(f.maxPrice, c.currency)) : "—"}</td></tr>`).join("");
  openPrint(`Billing form ${c.name}`, `<h1>${esc(c.name)}</h1><div class="muted">3PL billing contract · printed ${esc(dates.at(new Date().toISOString()))}</div>
    <div class="meta"><div><span>Client</span>${esc(c.clientName)}</div><div><span>Warehouse</span>${esc(c.warehouseCode)}</div><div><span>Calc. start date</span>${esc(printDay(c.calcStartDate))}</div><div><span>Billing period</span>${esc(FREQUENCY_LABELS[c.frequency] ?? c.frequency)}</div>
    <div><span>Approval</span>${esc(c.approvalStatus)}</div><div><span>Currency</span>${esc(c.currency)}</div><div><span>Fees</span>${c.fees.length}</div><div><span>Next period</span>${esc(printDay(c.nextPeriodStart))}</div></div>
    <h2>Fees</h2><table><thead><tr><th>Fee</th><th>Operation</th><th>Fee by</th><th>Charge by</th><th>Price</th><th class="r">Min</th><th class="r">Max</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted">No fees</td></tr>`}</tbody></table>`);
}

type PrintLine = { feeName: string; activityDate: string | null; referenceNumber: string | null; sku: string | null; quantity: number; unitPrice: number; adjustedPrice: number; lpNumber?: string | null; note?: string | null };
/** Which part of the bill a printout covers: the whole bill (header Print), or one tab. */
export type BillPrintSection = "all" | "consolidated" | "detailed";

/** Opens the print window at once, then fills it when the detailed lines arrive. */
export function printBill(b: ReportDetail, detail: readonly PrintLine[] | Promise<readonly PrintLine[]>, dates: PrintDates = DEFAULT_PRINT_DATES, section: BillPrintSection = "all"): void {
  const job = startPrint(`Bill ${b.billNumber}${section === "all" ? "" : section === "consolidated" ? " · Consolidated" : " · Detailed"}`);
  if (!job) return;
  Promise.resolve(detail).then((lines) => job.fill(billBody(b, lines, dates, section))).catch(() => {
    job.fail("Couldn't load the bill lines. Close this window and try Print again.");
    toast.error("Couldn't prepare the printout", "Try again in a moment.");
  });
}

function billBody(b: ReportDetail, detail: readonly PrintLine[], dates: PrintDates, section: BillPrintSection = "all"): string {
  const printDay = dates.day;
  const cons = b.consolidated.map((l) => `<tr><td>${esc(l.feeName)}</td><td>${esc(l.operationType)}</td><td>${esc(l.chargeBy)}</td><td class="r">${l.fromQty !== null ? `${esc(l.fromQty)}–${l.toQty ?? "∞"}` : ""}</td><td class="r">${esc(l.quantity)}</td><td class="r">${esc(l.unitPrice.toFixed(2))}</td><td class="r">${esc(l.minMaxAdjustment ? l.minMaxAdjustment.toFixed(2) : "")}</td><td class="r">${esc(moneyGrid(l.adjustedPrice, b.currency))}</td></tr>`).join("");
  const det = detail.slice(0, 2000).map((l) => `<tr><td>${esc(l.feeName)}</td><td>${esc(l.activityDate ? printDay(l.activityDate) : "")}</td><td>${esc(l.referenceNumber ?? "")}</td><td>${esc(l.lpNumber ?? "")}</td><td>${esc(l.sku ?? "")}</td><td>${esc(l.note ?? "")}</td><td class="r">${esc(l.quantity)}</td><td class="r">${esc(l.unitPrice.toFixed(2))}</td><td class="r">${esc(l.adjustedPrice.toFixed(2))}</td></tr>`).join("");
  return (`<h1>Bill ${esc(b.billNumber)}</h1><div class="muted">${esc(b.contractName)} · ${esc(b.billStatus)}</div>
    <div class="meta"><div><span>Client</span>${esc(b.clientName)}</div><div><span>Warehouse</span>${esc(b.warehouseCode)}</div><div><span>Period</span>${esc(printDay(b.periodStart))} – ${esc(printDay(b.periodEnd))}</div><div><span>Calculated</span>${esc(dates.at(b.calculatedAt))}</div></div>
    ${section === "detailed" ? "" : `<h2>Consolidated</h2><table><thead><tr><th>Fee</th><th>Operation</th><th>Charge by</th><th class="r">Tier</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Min/max adj.</th><th class="r">Amount</th></tr></thead><tbody>${cons}</tbody></table>`}
    <div class="total">Total ${esc(moneyRail(b.totalPrice, b.currency))}</div>${det && section !== "consolidated" ? `<h2>Detail</h2><table><thead><tr><th>Fee</th><th>Date</th><th>Reference</th><th>LP</th><th>SKU</th><th>Note</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>${det}</tbody></table>` : ""}`);
}

export function conditionLine(c: { field: string; comparator: string; value: unknown }): string {
  return conditionText(c);
}
