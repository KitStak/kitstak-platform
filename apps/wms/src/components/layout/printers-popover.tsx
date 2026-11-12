"use client";

import * as React from "react";
import { CheckCircle2, Download, Printer, ScanLine, Tag } from "lucide-react";
import { z } from "zod";
import { useApiMutation, useApiQuery } from "@/lib/query-client";
import { codeNameLabel } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioCards } from "@/components/ui/radio-cards";
import { useMe } from "@/lib/permissions-client";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { DisabledReason } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { HeaderIconButton } from "./header-icon-button";
import { openHelpArticle } from "./help-events";

export interface PrinterAssignment {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly barcodePrinter: string | null;
  readonly laserPrinter: string | null;
  /** Printers registered in the warehouse (searchable select list). */
  readonly barcodePrinters?: readonly string[];
  readonly laserPrinters?: readonly string[];
}

export const PRINTERS_QUERY_KEY = ["printers"] as const;
export const SELECT_PRINTER_REASON = "Select at least one printer";
const PRINTER_NAME_MAX = 120;
const printerNameSchema = z.string().trim().max(PRINTER_NAME_MAX, `Use at most ${PRINTER_NAME_MAX} characters`);

export interface PrinterDraft {
  readonly barcodePrinter: string;
  readonly laserPrinter: string;
}

/** Why Save is blocked, or null when the draft can be saved. */
export function printerSaveBlocker(draft: PrinterDraft): string | null {
  const invalid = !printerNameSchema.safeParse(draft.barcodePrinter).success || !printerNameSchema.safeParse(draft.laserPrinter).success;
  if (invalid) return `Use at most ${PRINTER_NAME_MAX} characters`;
  return draft.barcodePrinter.trim() || draft.laserPrinter.trim() ? null : SELECT_PRINTER_REASON;
}

/** Registered printers plus the current value (a scanned name not yet registered). */
export function printerOptions(registered: readonly string[] | undefined, current: string): readonly ComboboxOption[] {
  const names = new Set(registered ?? []);
  const trimmed = current.trim();
  if (trimmed) names.add(trimmed);
  return [...names].map((name) => ({ value: name, label: name }));
}

/**
 * Warehouses for the chooser: the active working-context warehouse first, then the rest
 * alphabetically by code ("KS2" after "MLT1" when MLT1 is the context).
 */
export function orderPrinterWarehouses<T extends Pick<PrinterAssignment, "warehouseId" | "warehouseCode">>(rows: readonly T[], contextWarehouseId: string | null): readonly T[] {
  return [...rows].sort((a, b) => {
    const aFirst = a.warehouseId === contextWarehouseId ? 0 : 1;
    const bFirst = b.warehouseId === contextWarehouseId ? 0 : 1;
    return aFirst - bFirst || a.warehouseCode.localeCompare(b.warehouseCode);
  });
}

/** The warehouse the popover opens on: explicit choice, else context, else the only one. */
export function defaultPrinterWarehouse(rows: readonly Pick<PrinterAssignment, "warehouseId">[], chosen: string | null, contextWarehouseId: string | null): string | null {
  if (chosen && rows.some((r) => r.warehouseId === chosen)) return chosen;
  if (contextWarehouseId && rows.some((r) => r.warehouseId === contextWarehouseId)) return contextWarehouseId;
  return rows.length === 1 ? rows[0]?.warehouseId ?? null : null;
}

function asOption(input: string): ComboboxOption {
  const name = input.trim().slice(0, PRINTER_NAME_MAX);
  return { value: name, label: name };
}

interface PrinterSlotProps {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** Pending pick shown in the select. */
  readonly value: string;
  /** Saved assignment shown in the header until Save succeeds. */
  readonly savedValue: string | null;
  readonly registered?: readonly string[];
  readonly onChange: (value: string) => void;
}

function PrinterSlot({ id, label, icon: Icon, value, savedValue, registered, onChange }: PrinterSlotProps) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-body">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
        {label}: <span className="font-normal text-secondary">{savedValue?.trim() || "Not selected"}</span>
      </label>
      <Combobox
        id={id}
        size="sm"
        aria-label={label}
        placeholder="Search and select"
        emptyText="No registered printers match"
        value={value.trim() || null}
        options={printerOptions(registered, value)}
        clearable
        creatable
        onCreate={asOption}
        onChange={(next) => onChange(next ?? "")}
      />
    </div>
  );
}

/** Direct Print agent (`GET /api/printers/agent` downloads it); it listens on this port on the workstation. */
export const PRINT_AGENT_URL = "http://127.0.0.1:9101";
export interface PrintAgentStatus { readonly ok: boolean; readonly version?: string; readonly printers?: readonly string[] }

const AGENT_SEEN_KEY = "ks-print-agent-seen";
const agentSeen = (): boolean => { try { return window.localStorage.getItem(AGENT_SEEN_KEY) === "1"; } catch { return false; } };

/**
 * Asks the local agent for its status while the popover is open (1.5 s timeout; null = not
 * detected). It probes on open only on workstations where the agent answered before, so a
 * workstation without it never logs a refused connection; "Check for agent" probes on demand.
 */
function usePrintAgent(active: boolean): { readonly status: PrintAgentStatus | null; readonly checked: boolean; readonly recheck: () => void } {
  const [state, setState] = React.useState<{ status: PrintAgentStatus | null; checked: boolean }>({ status: null, checked: false });
  const [tick, setTick] = React.useState(0);
  const probe = active && (tick > 0 || agentSeen());
  React.useEffect(() => {
    if (!probe) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1500);
    fetch(`${PRINT_AGENT_URL}/status`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() as Promise<PrintAgentStatus> : null))
      .then((status) => {
        setState({ status: status?.ok ? status : null, checked: true });
        try { if (status?.ok) window.localStorage.setItem(AGENT_SEEN_KEY, "1"); } catch { /* storage blocked */ }
      })
      .catch(() => setState({ status: null, checked: true }))
      .finally(() => window.clearTimeout(timer));
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [probe, tick]);
  return { ...state, checked: state.checked || (active && !probe), recheck: () => setTick((t) => t + 1) };
}

export type PrinterSlotKey = "barcodePrinter" | "laserPrinter";
/**
 * Scan-to-assign: a scanned printer label goes to the slot it names. Prefixes `BC:` / `LBL:`
 * (barcode) and `LS:` / `LZ:` (laser) win; then thermal-printer models (Zebra ZD/ZT/GK, Honeywell PC,
 * "label", "thermal") go to barcode; laser models go to laser; otherwise the first empty slot, barcode first.
 */
export function scanTarget(scan: string, draft: PrinterDraft): { readonly slot: PrinterSlotKey; readonly name: string } | null {
  const raw = scan.trim();
  if (!raw) return null;
  const prefixed = /^(BC|LBL|LS|LZ):\s*(.+)$/i.exec(raw);
  if (prefixed) return { slot: /^(BC|LBL)$/i.test(prefixed[1] ?? "") ? "barcodePrinter" : "laserPrinter", name: (prefixed[2] ?? "").trim().slice(0, PRINTER_NAME_MAX) };
  const name = raw.slice(0, PRINTER_NAME_MAX);
  if (/zebra|\bz[dtq]\d|\bgk4|\bgx4|label|thermal|honeywell\s*pc|\bzpl\b/i.test(raw)) return { slot: "barcodePrinter", name };
  if (/laser|laserjet|officejet|brother\s*hl|\bpdf\b/i.test(raw)) return { slot: "laserPrinter", name };
  return { slot: !draft.barcodePrinter.trim() ? "barcodePrinter" : !draft.laserPrinter.trim() ? "laserPrinter" : "barcodePrinter", name };
}

export function testLabelZpl(printer: string, warehouse: string): string {
  const safe = (v: string) => v.replace(/[\^~]/g, "").slice(0, 40);
  return `^XA^CI28^FO40,30^A0N,40,40^FDKitStak test label^FS^FO40,90^A0N,28,28^FDPrinter: ${safe(printer)}^FS^FO40,130^A0N,28,28^FDWarehouse: ${safe(warehouse)}^FS^FO40,180^BY2^BCN,80,Y,N,N^FDKITSTAK-TEST^FS^XZ`;
}

function StepPill({ n, label, active, done }: { readonly n: number; readonly label: string; readonly active: boolean; readonly done: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 text-2xs ${active ? "font-semibold text-foreground" : "text-secondary"}`}>
      <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full text-2xs font-semibold ${active ? "bg-primary text-white" : done ? "bg-success-soft text-success" : "bg-neutral-soft text-secondary"}`}>{done ? "✓" : n}</span>
      {label}
    </span>
  );
}

/** After this long without an answer the popover offers Retry instead of a bare skeleton. */
export const PRINTERS_SLOW_MS = 6000;
const PRINTERS_PREFETCH_MS = 2500;

/** True once `active` has stayed true for `ms` (resets when it turns false). */
function useSlow(active: boolean, ms: number): boolean {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => {
      window.clearTimeout(timer);
      setSlow(false);
    };
  }, [active, ms]);
  return active && slow;
}

/** Selector-shaped placeholder: reads as "warehouse + two printers are coming", not a grey block. */
function PrintersSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading printers">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Direct Print setup: per-warehouse barcode + laser printer for this user (`user_printers`). */
export function PrintersPopover() {
  const me = useMe();
  const contextWarehouseId = me.data?.data.context.warehouseId ?? null;
  const [open, setOpen] = React.useState(false);
  // Prefetch on hover/focus of the trigger so the popover usually opens with data.
  const [armed, setArmed] = React.useState(false);
  // Warm the cache shortly after the shell loads, so the first open shows the slots at once.
  React.useEffect(() => { const t = window.setTimeout(() => setArmed(true), PRINTERS_PREFETCH_MS); return () => window.clearTimeout(t); }, []);
  const [chosenWarehouseId, setWarehouseId] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"warehouse" | "printers">("printers");
  /** Edits for the selected warehouse; null = show its saved assignment. */
  const [edits, setEdits] = React.useState<{ readonly warehouseId: string; readonly draft: PrinterDraft } | null>(null);
  const printers = useApiQuery<readonly PrinterAssignment[]>(PRINTERS_QUERY_KEY, open || armed ? "/api/printers" : null);
  const slow = useSlow(open && printers.isLoading, PRINTERS_SLOW_MS);
  const save = useApiMutation<{ warehouseId: string; barcodePrinter: string | null; laserPrinter: string | null }, PrinterAssignment>({
    path: "/api/printers",
    method: "PUT",
    invalidate: [PRINTERS_QUERY_KEY],
    successMessage: "Printer assignment saved.",
    onSuccess: () => setOpen(false),
  });

  const rows = React.useMemo(() => orderPrinterWarehouses(printers.data?.data ?? [], contextWarehouseId), [printers.data, contextWarehouseId]);
  const warehouseId = defaultPrinterWarehouse(rows, chosenWarehouseId, contextWarehouseId);
  const selected = rows.find((row) => row.warehouseId === warehouseId) ?? null;
  const draft: PrinterDraft =
    edits && edits.warehouseId === selected?.warehouseId
      ? edits.draft
      : { barcodePrinter: selected?.barcodePrinter ?? "", laserPrinter: selected?.laserPrinter ?? "" };
  const setDraft = (update: (d: PrinterDraft) => PrinterDraft): void => {
    if (selected) setEdits({ warehouseId: selected.warehouseId, draft: update(draft) });
  };
  const saveBlocker = printerSaveBlocker(draft);
  const agent = usePrintAgent(open);
  const [scan, setScan] = React.useState("");
  const [scanNote, setScanNote] = React.useState<string | null>(null);
  const applyScan = (): void => {
    const target = scanTarget(scan, draft);
    if (!target) return;
    setDraft((d) => ({ ...d, [target.slot]: target.name }));
    setScanNote(`${target.name} → ${target.slot === "barcodePrinter" ? "barcode printer" : "laser printer"}`);
    setScan("");
  };
  const [testing, setTesting] = React.useState(false);
  const sendTest = async (): Promise<void> => {
    if (!selected || !draft.barcodePrinter.trim()) return;
    setTesting(true);
    try {
      const zpl = testLabelZpl(draft.barcodePrinter.trim(), selected.warehouseCode);
      const r = await fetch(`${PRINT_AGENT_URL}/print`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer: draft.barcodePrinter.trim(), format: "zpl", data: btoa(zpl) }) });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setScanNote(body.ok ? "Test label sent to the barcode printer." : `Test label failed: ${body.error ?? r.statusText}`);
    } catch {
      setScanNote("Test label failed: the Direct Print agent stopped answering.");
      agent.recheck();
    } finally {
      setTesting(false);
    }
  };
  const currentStep = selected ? step : "warehouse";

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setStep("printers");
      setEdits(null);
      setScan("");
      setScanNote(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <HeaderIconButton label="Printers" onPointerEnter={() => setArmed(true)} onFocus={() => setArmed(true)}>
          <Printer className="h-4 w-4" aria-hidden />
        </HeaderIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
          <Printer className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">Printers</h2>
        </div>
        <div className="space-y-3 p-3">
          {agent.status ? (
            <p className="flex items-center gap-1.5 rounded-md bg-success-soft px-2.5 py-1.5 text-xs text-success" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Direct Print agent {agent.status.version ? `v${agent.status.version} ` : ""}connected
              {agent.status.printers?.length ? <span className="text-secondary">· {agent.status.printers.length} printers</span> : null}
            </p>
          ) : agent.checked ? (
            <Callout variant="info" title="Direct Print agent not connected">
              Your assignment still saves; printouts open in the browser print dialog until the agent runs on this workstation.{" "}
              <a href="/api/printers/agent" download className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline"><Download className="h-3 w-3" aria-hidden />Download agent</a>
              {" · "}
              <button type="button" onClick={() => agent.recheck()} className="font-semibold text-primary underline-offset-2 hover:underline">Check for agent</button>
              {" · "}
              <button type="button" onClick={() => { setOpen(false); openHelpArticle("direct-print"); }} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40">Setup guide</button>
            </Callout>
          ) : null}
          {printers.isSuccess && rows.length > 0 ? (
            <div className="flex items-center gap-3" aria-label="Steps">
              <StepPill n={1} label="Warehouse" active={currentStep === "warehouse"} done={currentStep === "printers"} />
              <span className="h-px w-6 bg-border" aria-hidden />
              <StepPill n={2} label="Printers" active={currentStep === "printers"} done={false} />
            </div>
          ) : null}
          {printers.isLoading && !slow ? <PrintersSkeleton /> : null}
          {slow ? (
            <Callout variant="attention" action={<Button size="sm" onClick={() => void printers.refetch({ cancelRefetch: true })}>Retry</Button>}>
              Printers are taking longer than usual to load.
            </Callout>
          ) : null}
          {printers.isError ? <Callout variant="error" action={<Button size="sm" onClick={() => void printers.refetch()}>Retry</Button>}>Could not load printers.</Callout> : null}
          {printers.isSuccess && rows.length === 0 ? <p className="text-xs text-secondary">You have no warehouses assigned.</p> : null}
          {printers.isSuccess && rows.length > 0 && currentStep === "warehouse" ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-body">Warehouse selection</p>
              <RadioCards
                ariaLabel="Warehouse"
                value={warehouseId}
                onChange={(id) => setWarehouseId(id)}
                className="max-h-[220px] gap-1.5 overflow-y-auto"
                options={rows.map((row) => ({
                  value: row.warehouseId,
                  title: codeNameLabel(row.warehouseCode, row.warehouseName),
                  description: row.warehouseId === contextWarehouseId ? "Current working context" : undefined,
                }))}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <DisabledReason reason={selected ? null : "Select a warehouse"}>
                  <Button size="sm" variant="primary" disabled={!selected} onClick={() => setStep("printers")}>Next</Button>
                </DisabledReason>
              </div>
            </div>
          ) : null}
          {printers.isSuccess && selected && currentStep === "printers" ? (
            <div className="space-y-2.5">
              <p className="text-xs text-secondary">
                Warehouse: <span className="font-semibold text-body">{codeNameLabel(selected.warehouseCode, selected.warehouseName)}</span>{" "}
                <button type="button" onClick={() => setStep("warehouse")} className="font-semibold text-primary hover:underline">Change</button>
              </p>
              <div className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden />
                <Input
                  aria-label="Scan a printer label"
                  placeholder="Scan a printer label to assign it"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyScan(); } }}
                  className="h-8 text-xs"
                />
              </div>
              {scanNote ? <p className="text-2xs text-secondary" role="status">{scanNote}</p> : null}
              <PrinterSlot id="barcode-printer" label="Selected barcode printer" icon={Tag} value={draft.barcodePrinter} savedValue={selected.barcodePrinter} registered={selected.barcodePrinters} onChange={(v) => setDraft((d) => ({ ...d, barcodePrinter: v }))} />
              <PrinterSlot id="laser-printer" label="Selected laser printer" icon={Printer} value={draft.laserPrinter} savedValue={selected.laserPrinter} registered={selected.laserPrinters} onChange={(v) => setDraft((d) => ({ ...d, laserPrinter: v }))} />
              <div className="flex items-center justify-end gap-2 pt-1">
                {agent.status ? (
                  <DisabledReason reason={draft.barcodePrinter.trim() ? null : "Select a barcode printer"}>
                    <Button size="sm" variant="ghost" className="mr-auto" disabled={testing || !draft.barcodePrinter.trim()} onClick={() => void sendTest()}>{testing ? "Sending…" : "Test label"}</Button>
                  </DisabledReason>
                ) : null}
                <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <DisabledReason reason={save.isPending ? null : saveBlocker}>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={save.isPending || saveBlocker !== null}
                    onClick={() => save.mutate({ warehouseId: selected.warehouseId, barcodePrinter: draft.barcodePrinter.trim() || null, laserPrinter: draft.laserPrinter.trim() || null })}
                  >
                    {save.isPending ? "Saving…" : "Save"}
                  </Button>
                </DisabledReason>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
