"use client";

/**
 * Destination pickers for the inventory drawers (Add Inventory, Transfer Product, Transfer
 * LP / Location). Same look as the shared Location / LP pickers, but each option carries its
 * restriction for the SKUs being placed (`GET /api/inventory/destinations`):
 *   - "Locked by count CNT…" and an occupied only-1-SKU location / LP type are disabled, with
 *     the reason in the option's second line, so they never look selectable;
 *   - an empty only-1-SKU destination is selectable and labelled "Only 1 SKU".
 * Picking an option seeds the drawer's placement pre-flight with the same result, so there is
 * no "Checking the destination…" round-trip after the pick (the server still re-checks on Save).
 */
import * as React from "react";
import { ScanLine } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { useBarcodeScanner } from "@/lib/scan";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip } from "@/components/ui/tooltip";
import type { PlacementCheck } from "./inventory-form-kit";

export type DestinationKind = "location" | "lp";
export type Destination = { readonly kind: DestinationKind; readonly id: string } | null;

export interface DestinationOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly blocking: string | null;
  readonly badge: string | null;
  readonly countLockPlan: string | null;
  readonly notes: readonly string[];
}

/** Combobox option for a destination: blocked rows are disabled and say why. */
export function toDestinationOption(o: DestinationOption): ComboboxOption {
  return { value: o.id, label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.blocking ? { disabled: true } : {}) };
}

/** Same key shape as `usePlacementCheck`, so a pick pre-fills the pre-flight. */
export function placementKey(kind: DestinationKind, id: string, productIds: readonly string[], exclude: readonly string[]) {
  return ["inventory-placement-check", { kind, id, productIds: productIds.join(","), exclude: exclude.join(",") }] as const;
}

interface PickerProps {
  readonly kind: DestinationKind;
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
  readonly warehouseId: string | null;
  readonly productIds?: readonly string[];
  readonly exclude?: readonly string[];
  readonly id?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly onBlur?: () => void;
  readonly placeholder?: string;
  /** Called when a scan finds nothing (or only a blocked destination). */
  readonly onScanMiss?: (code: string, reason: string | null) => void;
}

export function DestinationSinglePicker({ kind, value, onChange, warehouseId, productIds = [], exclude = [], id, disabled, invalid, onBlur, placeholder, onScanMiss }: PickerProps) {
  const qc = useQueryClient();
  const known = React.useRef(new Map<string, DestinationOption>());
  const productKey = productIds.join(",");
  const excludeKey = exclude.join(",");

  const search = React.useCallback(
    async (q: string, signal?: AbortSignal, exact = false): Promise<readonly DestinationOption[]> => {
      const res = await apiRequest<DestinationOption[]>("/api/inventory/destinations", {
        query: { kind, q, warehouseId: warehouseId ?? undefined, productIds: productKey || undefined, exclude: excludeKey || undefined, exact: exact ? "1" : undefined },
        signal,
      });
      for (const o of res.data) known.current.set(o.id, o);
      return res.data;
    },
    [kind, warehouseId, productKey, excludeKey],
  );

  const loadOptions = React.useCallback(async (q: string, signal: AbortSignal) => (await search(q, signal)).map(toDestinationOption), [search]);

  const pick = React.useCallback(
    (next: string | null) => {
      const opt = next ? known.current.get(next) : undefined;
      if (opt) {
        const check: PlacementCheck = { kind, id: opt.id, code: opt.label, countLockPlan: opt.countLockPlan, blocking: opt.blocking, notes: opt.notes };
        qc.setQueryData(placementKey(kind, opt.id, productKey ? productKey.split(",") : [], excludeKey ? excludeKey.split(",") : []), check);
      }
      onChange(next);
    },
    [kind, onChange, productKey, excludeKey, qc],
  );

  const selected = value ? known.current.get(value) : undefined;
  const label = kind === "location" ? "Location" : "License plate";
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Combobox
          // Re-mount when the warehouse or the SKUs change, so options are re-evaluated for them.
          key={`${kind}|${warehouseId ?? ""}|${productKey}|${excludeKey}`}
          id={id}
          aria-label={label}
          loadOptions={loadOptions}
          minChars={0}
          selectedOptions={selected ? [toDestinationOption(selected)] : undefined}
          value={value}
          onChange={(v) => pick(v)}
          placeholder={placeholder ?? (kind === "location" ? "Search location" : "Search LP number")}
          emptyText={kind === "location" ? "No active location matches" : "No LP matches"}
          disabled={disabled}
          invalid={invalid}
          onBlur={onBlur}
          clearable
        />
      </div>
      <DestinationScanButton
        disabled={disabled}
        onScan={(code) => {
          search(code, undefined, true)
            .then((items) => {
              const hit = items[0];
              if (hit && !hit.blocking) pick(hit.id);
              else onScanMiss?.(code, hit?.blocking ?? null);
            })
            .catch(() => onScanMiss?.(code, null));
        }}
      />
    </div>
  );
}

function DestinationScanButton({ onScan, disabled }: { readonly onScan: (code: string) => void; readonly disabled?: boolean }) {
  const [armed, setArmed] = React.useState(false);
  const resolve = React.useCallback((code: string) => { setArmed(false); onScan(code); }, [onScan]);
  useBarcodeScanner(resolve, { enabled: armed, allowInInputs: true });
  return (
    <Tooltip content={armed ? "Scan now… (click to cancel)" : "Scan a barcode"}>
      <button
        type="button"
        aria-pressed={armed}
        aria-label="Scan barcode"
        disabled={disabled}
        onClick={() => setArmed(!armed)}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:opacity-45 ${armed ? "animate-pulse border-primary bg-primary-soft text-primary" : "border-border-strong/70 text-secondary hover:bg-surface-sunken"}`}
      >
        <ScanLine className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** Location ⇄ License plate segmented picker (Transfer Product / Transfer LP-Location target). */
export function DestinationPicker({ value, onChange, warehouseId, productIds, exclude, disabled, onScanMiss }: {
  readonly value: Destination;
  readonly onChange: (value: Destination) => void;
  readonly warehouseId: string | null;
  readonly productIds?: readonly string[];
  readonly exclude?: readonly string[];
  readonly disabled?: boolean;
  readonly onScanMiss?: (code: string, reason: string | null) => void;
}) {
  const [kind, setKind] = React.useState<DestinationKind>(value?.kind ?? "location");
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl<DestinationKind>
        size="sm"
        ariaLabel="Target type"
        value={kind}
        disabled={disabled}
        onChange={(k) => { setKind(k); onChange(null); }}
        options={[{ value: "location", label: "Location" }, { value: "lp", label: "License plate" }]}
      />
      <DestinationSinglePicker
        kind={kind}
        warehouseId={warehouseId}
        productIds={productIds}
        exclude={exclude}
        disabled={disabled}
        value={value?.kind === kind ? value.id : null}
        onChange={(id) => onChange(id ? { kind, id } : null)}
        onScanMiss={onScanMiss}
      />
    </div>
  );
}
