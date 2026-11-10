"use client";

import * as React from "react";
import { Printer, Tag } from "lucide-react";
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
import { HeaderIconButton } from "./header-icon-button";

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
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-body">
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

/** After this long without an answer the popover offers Retry instead of a bare skeleton. */
export const PRINTERS_SLOW_MS = 6000;

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
  const currentStep = selected ? step : "warehouse";

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setStep("printers");
      setEdits(null);
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
          <h2 className="text-[14px] font-semibold text-foreground">Printers</h2>
        </div>
        <div className="space-y-3 p-3">
          <Callout variant="info">Printing application has not been installed yet. Direct Print falls back to the browser print dialog.</Callout>
          {printers.isLoading && !slow ? <PrintersSkeleton /> : null}
          {slow ? (
            <Callout variant="attention" action={<Button size="sm" onClick={() => void printers.refetch({ cancelRefetch: true })}>Retry</Button>}>
              Printers are taking longer than usual to load.
            </Callout>
          ) : null}
          {printers.isError ? <Callout variant="error" action={<Button size="sm" onClick={() => void printers.refetch()}>Retry</Button>}>Could not load printers.</Callout> : null}
          {printers.isSuccess && rows.length === 0 ? <p className="text-[12px] text-secondary">You have no warehouses assigned.</p> : null}
          {printers.isSuccess && rows.length > 0 && currentStep === "warehouse" ? (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-body">Warehouse selection</p>
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
              <p className="text-[12px] text-secondary">
                Warehouse: <span className="font-semibold text-body">{codeNameLabel(selected.warehouseCode, selected.warehouseName)}</span>{" "}
                <button type="button" onClick={() => setStep("warehouse")} className="font-semibold text-primary hover:underline">Change</button>
              </p>
              <PrinterSlot id="barcode-printer" label="Selected barcode printer" icon={Tag} value={draft.barcodePrinter} savedValue={selected.barcodePrinter} registered={selected.barcodePrinters} onChange={(v) => setDraft((d) => ({ ...d, barcodePrinter: v }))} />
              <PrinterSlot id="laser-printer" label="Selected laser printer" icon={Printer} value={draft.laserPrinter} savedValue={selected.laserPrinter} registered={selected.laserPrinters} onChange={(v) => setDraft((d) => ({ ...d, laserPrinter: v }))} />
              <div className="flex justify-end gap-2 pt-1">
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
