"use client";

/**
 * Transfer LP / Transfer Location drawers (spec 04 §2.5–2.6): Warehouse → source (server
 * search) + Find → summary card (LP, Lot, Pack Type, Pack Qty, SKU Multi, SKU Qty,
 * Expiry, Production) → Move to LP/Location → Transfer. After the move the drawer
 * lists every SKU that moved (KitStaks addition) instead of just closing.
 */
import * as React from "react";
import { CheckCircle2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiMutation } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { DisabledReason } from "@/components/ui/tooltip";
import { LocationOrLpPicker, LocationPicker, LpPicker, WarehouseSelect, type LocationOrLp } from "@/components/shared/entity-pickers";
import { Fact } from "./bucket-card";
import { InventoryStatusPill, formatQty } from "./inventory-shared";
import type { TransferResult } from "./by-location-types";

export type ContainerKind = "lp" | "location";

interface ContentLine {
  readonly sku: string;
  readonly productName: string;
  readonly qty: number;
  readonly allocated: number;
  readonly packType: string;
  readonly status: string;
  readonly lotNumber: string | null;
  readonly lpNumber: string | null;
}

interface ContentSummary {
  readonly kind: ContainerKind;
  readonly id: string;
  readonly code: string;
  readonly locationCode: string | null;
  readonly lpLabel: string;
  readonly lotLabel: string;
  readonly packTypeLabel: string;
  readonly packQty: number;
  readonly skuLabel: string;
  readonly skuCount: number;
  readonly expiryLabel: string;
  readonly productionLabel: string;
  readonly allocatedQty: number;
  readonly lines: readonly ContentLine[];
}

const COPY: Readonly<Record<ContainerKind, { title: string; from: string; required: string; placeholder: string }>> = {
  lp: { title: "Transfer LP", from: "Transfer from Parent LP/LP", required: "Transfer from Parent LP/LP is required.", placeholder: "Search LP number" },
  location: { title: "Transfer Location", from: "Transfer from Location", required: "Transfer from Location is required.", placeholder: "Search location (3+ characters)" },
};

export function TransferContainerDrawer({ kind, onClose, onDone }: { readonly kind: ContainerKind | null; readonly onClose: () => void; readonly onDone: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  return (
    <Drawer open={kind !== null} onOpenChange={(o) => (o ? undefined : onClose())} title={kind ? COPY[kind].title : ""} width={45} dirty={dirty}>
      {kind ? <TransferContainerBody key={kind} kind={kind} onClose={onClose} onDone={onDone} onDirty={setDirty} /> : null}
    </Drawer>
  );
}

function TransferContainerBody({ kind, onClose, onDone, onDirty }: { readonly kind: ContainerKind; readonly onClose: () => void; readonly onDone: () => void; readonly onDirty: (d: boolean) => void }) {
  const copy = COPY[kind];
  const me = useMe();
  const [warehouseId, setWarehouseId] = React.useState<string | null>(me.data?.data.context.warehouseId ?? null);
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<ContentSummary | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<LocationOrLp>(null);
  const [targetError, setTargetError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<TransferResult | null>(null);

  React.useEffect(() => onDirty(Boolean(sourceId || target) && !result), [sourceId, target, result, onDirty]);

  const [warehouseError, setWarehouseError] = React.useState<string | null>(null);
  const find = async () => {
    if (!warehouseId) {
      setWarehouseError("Warehouse is required.");
      return;
    }
    if (!sourceId) {
      setSourceError(copy.required);
      return;
    }
    setFinding(true);
    setSourceError(null);
    try {
      setSummary(await apiFetch<ContentSummary>("/api/inventory/summary", { query: { kind, id: sourceId } }));
    } catch (e) {
      setSourceError(e instanceof Error ? e.message : "Couldn't load the contents");
    } finally {
      setFinding(false);
    }
  };

  const mutation = useApiMutation<{ target: NonNullable<LocationOrLp> }, TransferResult>({
    path: kind === "lp" ? "/api/inventory/transfer-lp" : "/api/inventory/transfer-location",
    body: (v) => (kind === "lp" ? { lpId: sourceId, target: v.target } : { fromLocationId: sourceId, target: v.target }),
    invalidate: [["grid"], ["inventory"]],
    successMessage: (d) => `Moved ${formatQty(d.totalQty)} units across ${d.moved.length} SKU line${d.moved.length === 1 ? "" : "s"}.`,
    onError: (e) => setTargetError(e.message),
    onSuccess: (d) => {
      setResult(d);
      onDone();
    },
  });

  const empty = summary !== null && summary.lines.length === 0 && kind === "location";
  const transferReason = !summary ? "Find the source first" : empty ? "This location is empty" : !target ? "Pick where to move it" : targetError ? "Fix the highlighted field first" : null;

  if (result) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {summary?.code} transferred · {formatQty(result.totalQty)} units
        </div>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-faint"><tr><th className="py-1">SKU</th><th>From</th><th>To</th><th className="text-right">Qty</th></tr></thead>
          <tbody>
            {result.moved.map((m) => (
              <tr key={`${m.sku}:${m.from}:${m.to}`} className="border-t border-border"><td className="py-1.5 font-medium">{m.sku}</td><td>{m.from}</td><td>{m.to}</td><td className="text-right tabular-nums">{formatQty(m.qty)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={() => { setResult(null); setSummary(null); setSourceId(null); setTarget(null); }}>Transfer another</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex h-full flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (target && !transferReason) mutation.mutate({ target }); }} noValidate>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="tc-warehouse" required>Warehouse</FieldLabel>
        <WarehouseSelect id="tc-warehouse" value={warehouseId} invalid={Boolean(warehouseError)} onChange={(v) => { setWarehouseId(v); setWarehouseError(null); setSourceId(null); setSummary(null); setTarget(null); }} clearable={false} />
        <FieldError id="tc-warehouse-error" message={warehouseError ?? undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="tc-source" required>{copy.from}</FieldLabel>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            {kind === "lp"
              ? <LpPicker id="tc-source" warehouseId={warehouseId} disabled={!warehouseId} value={sourceId} invalid={Boolean(sourceError)} onChange={(v) => { setSourceId(v); setSummary(null); setSourceError(null); }} placeholder={copy.placeholder} />
              : <LocationPicker id="tc-source" warehouseId={warehouseId} disabled={!warehouseId} value={sourceId} invalid={Boolean(sourceError)} onChange={(v) => { setSourceId(v); setSummary(null); setSourceError(null); }} placeholder={copy.placeholder} />}
          </div>
          <Button variant="secondary" onClick={() => void find()} disabled={finding} aria-label="Find">
            {finding ? <Spinner className="h-3.5 w-3.5" label="Finding" /> : <Search className="h-3.5 w-3.5" aria-hidden />}
            Find
          </Button>
        </div>
        <FieldError id="tc-source-error" message={sourceError ?? undefined} />
      </div>

      {summary ? (
        <section aria-label="Contents" className="rounded-lg border border-border bg-surface-sunken/60 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold text-foreground">{summary.code}</span>
            {summary.kind === "lp" ? <span className="text-[12px] text-secondary">in {summary.locationCode ?? "no location"}</span> : null}
          </div>
          <dl className="mt-2 grid grid-cols-4 gap-x-4 gap-y-2">
            <Fact label="LP">{summary.lpLabel}</Fact>
            <Fact label="Lot/Batch Num.">{summary.lotLabel}</Fact>
            <Fact label="Pack Type">{summary.packTypeLabel}</Fact>
            <Fact label="Pack Qty">{formatQty(summary.packQty)}</Fact>
            <Fact label="SKU">{summary.skuLabel}</Fact>
            <Fact label="SKU Qty">{summary.skuCount}</Fact>
            <Fact label="Expiry Date">{summary.expiryLabel}</Fact>
            <Fact label="Production Date">{summary.productionLabel}</Fact>
          </dl>
          {summary.lines.length > 0 ? (
            <ul className="mt-3 max-h-40 divide-y divide-border overflow-auto rounded-md border border-border bg-surface text-[12px]">
              {summary.lines.map((l, i) => (
                <li key={`${l.sku}:${i}`} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="font-medium text-foreground">{l.sku}</span>
                  <InventoryStatusPill status={l.status} />
                  {l.lpNumber && kind === "location" ? <span className="text-faint">LP {l.lpNumber}</span> : null}
                  <span className="ml-auto tabular-nums">{formatQty(l.qty)} {l.packType}</span>
                  {l.allocated > 0 ? <span className="text-[11px] text-primary">({formatQty(l.allocated)} allocated, moves with it)</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-[12px] text-secondary">{kind === "lp" ? "This LP is empty; it will move on its own." : "This location is empty."}</p>}
        </section>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <FieldLabel required>Move to LP/Location</FieldLabel>
        <LocationOrLpPicker value={target} onChange={(v) => { setTarget(v); setTargetError(null); }} warehouseId={warehouseId} disabled={!summary || empty} />
        <FieldError id="tc-target-error" message={targetError ?? undefined} />
      </div>

      <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <DisabledReason reason={mutation.isPending ? null : transferReason}>
          <Button type="submit" variant="primary" disabled={transferReason !== null || mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending ? <Spinner className="h-3.5 w-3.5" label="Transferring" /> : null}
            Transfer
          </Button>
        </DisabledReason>
      </div>
    </form>
  );
}
