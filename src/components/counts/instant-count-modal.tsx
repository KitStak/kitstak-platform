"use client";

/**
 * Quick Count / Instant Count (M07 checklist 8). Scan a location, enter the counted qty
 * per SKU / lot, submit. Creates an `IC<timestamp>` Instant Count plan through
 * `POST /api/counts/instant`, which executes the count task; with "Update inventory now"
 * the variances post straight to the ledger, and a count with no difference always
 * closes as Inventory Updated, so no open line is left behind.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, ScanLine, Search, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/permissions-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { LookupSelect, WarehouseSelect } from "@/components/shared/entity-pickers";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { CountEntryTable, draftsError, draftsFromBuckets, toPayload, type EntryDraft, type SheetBucket } from "./count-entry-table";
import { errorMessage, useCountCan } from "./counts-client";

interface InstantLocation {
  readonly locationId: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly buckets: readonly SheetBucket[];
  readonly openCount: string | null;
}

interface InstantResult {
  readonly planId: string;
  readonly code: string;
  readonly status: string;
  readonly varianceLines: number;
}

export function InstantCountModal({ open, onOpenChange, onDone }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">{open ? <Body onOpenChange={onOpenChange} onDone={onDone} /> : null}</DialogContent>
    </Dialog>
  );
}

function Body({ onOpenChange, onDone }: { readonly onOpenChange: (open: boolean) => void; readonly onDone: () => void }) {
  const router = useRouter();
  const me = useMe();
  const canUpdate = useCountCan([P.updateInv, P.mobileInstantUpdate], "any").allowed;
  const ctx = me.data?.data;
  const initialWarehouse = ctx?.context.warehouseId ?? (ctx?.contextOptions.warehouses.length === 1 ? ctx.contextOptions.warehouses[0]?.id ?? null : null);
  const [pickedWarehouse, setWarehouseId] = React.useState<string | null>(null);
  const warehouseId = pickedWarehouse ?? initialWarehouse;
  const [code, setCode] = React.useState("");
  const [location, setLocation] = React.useState<InstantLocation | null>(null);
  const [drafts, setDrafts] = React.useState<readonly EntryDraft[]>([]);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [looking, setLooking] = React.useState(false);
  const [updateWanted, setUpdateNow] = React.useState(true);
  const updateNow = canUpdate && updateWanted;
  const [reasonId, setReasonId] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const scanRef = React.useRef<HTMLInputElement>(null);


  const lookup = async () => {
    const scanned = code.trim();
    if (!warehouseId) { setLookupError("Choose a warehouse first"); return; }
    if (!scanned) { setLookupError("Scan or type a location code"); scanRef.current?.focus(); return; }
    setLooking(true);
    setLookupError(null);
    try {
      const loc = await apiFetch<InstantLocation>("/api/counts/instant/location", { query: { warehouseId, code: scanned } });
      setLocation(loc);
      setDrafts(draftsFromBuckets(loc.buckets));
      setTried(false);
    } catch (error) {
      setLocation(null);
      setDrafts([]);
      setLookupError(errorMessage(error, "The location could not be found."));
      requestAnimationFrame(() => scanRef.current?.select());
    } finally {
      setLooking(false);
    }
  };

  const entryError = draftsError(drafts);
  const submitReason = !location ? "Scan a location first" : saving ? "Submitting…" : null;

  const submit = async () => {
    setTried(true);
    if (!location || !warehouseId || entryError) return;
    setSaving(true);
    try {
      const res = await apiFetch<InstantResult>("/api/counts/instant", { method: "POST", body: { warehouseId, locationId: location.locationId, entries: toPayload(drafts), updateInventory: updateNow, reasonId } });
      const closed = res.status === "Inventory Updated";
      toast.show({
        variant: "success", title: "Success",
        message: closed ? `${res.code}: ${location.code} counted and inventory updated.` : `${res.code}: ${location.code} counted. ${res.varianceLines} line waits for Update Inv.`,
        action: { label: "Open count", onClick: () => router.push(`/counts/${encodeURIComponent(res.code)}`) },
      });
      onDone();
      setLocation(null);
      setDrafts([]);
      setCode("");
      setTried(false);
      requestAnimationFrame(() => scanRef.current?.focus());
    } catch (error) {
      toast.error("Error", errorMessage(error, "The count could not be submitted."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader title="Quick count" description="Count one location now. KitStaks creates an Instant Count plan (IC + timestamp) and closes it in one step." />
      <DialogBody>
        <div className="flex flex-col gap-4">
          <form noValidate className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto] md:items-start" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ic-wh" required>Warehouse</FieldLabel>
              <WarehouseSelect id="ic-wh" value={warehouseId} onChange={(v) => { setWarehouseId(v); setLocation(null); setDrafts([]); }} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ic-loc" required>Location</FieldLabel>
              <TextField id="ic-loc" ref={scanRef} autoFocus value={code} maxLength={120} placeholder="Scan or type a location code" onChange={(e) => setCode(e.target.value)} invalid={Boolean(lookupError)} aria-describedby={lookupError ? "ic-loc-err" : undefined}
                leading={<ScanLine className="h-4 w-4 text-faint" aria-hidden />} />
              <FieldError id="ic-loc-err" message={lookupError ?? undefined} />
            </div>
            <Button type="submit" variant="secondary" className="md:mt-[22px]" disabled={looking}>{looking ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" aria-hidden />}Find</Button>
          </form>

          {location ? (
            <section aria-label={`Count ${location.code}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft px-2.5 py-1 text-[13px] font-semibold text-primary"><MapPin className="h-3.5 w-3.5" aria-hidden />{location.code}</span>
                <span className="text-[12px] text-secondary">{location.buckets.length} {location.buckets.length === 1 ? "bucket" : "buckets"} expected</span>
              </div>
              {location.openCount ? (
                <Callout variant="attention" title="This location is already in an open count">
                  Count plan <Link className="font-semibold text-primary hover:underline" href={`/counts/${encodeURIComponent(location.openCount)}`}>{location.openCount}</Link> is waiting for it. A quick count still works, but the other count will compare against the new quantity.
                </Callout>
              ) : null}
              <CountEntryTable drafts={drafts} onChange={setDrafts} warehouseId={location.warehouseId} disabled={saving} showErrors={tried} idPrefix="ic" />
              {tried && entryError ? <p role="alert" className="text-[12px] font-medium text-danger">{entryError}</p> : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="ic-update" info="When off, counted differences wait on the count plan for Update Inv. A count with no difference always closes.">Update inventory now</FieldLabel>
                  <DisabledReason reason={canUpdate ? null : "You don't have permission to update inventory from a count"}>
                    <span><YesNoToggle id="ic-update" value={updateNow} onChange={setUpdateNow} disabled={!canUpdate} ariaLabel="Update inventory now" /></span>
                  </DisabledReason>
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="ic-reason">Adjustment reason</FieldLabel>
                  <LookupSelect id="ic-reason" type="adjustment_reason" aria-label="Adjustment reason" value={reasonId} onChange={(v) => setReasonId(v)} placeholder="Optional" disabled={!updateNow} clearable />
                </div>
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><Zap className="h-5 w-5" aria-hidden /></span>
              <p className="text-[13px] font-semibold text-foreground">Scan a location to start</p>
              <p className="max-w-[420px] text-[12px] text-secondary">The expected SKUs, lots and LPs appear here. Enter what you see on the shelf, then submit. The next location is ready to scan right after.</p>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
        <DisabledReason reason={submitReason}>
          <Button variant="primary" disabled={Boolean(submitReason)} onClick={() => void submit()}>{saving ? <Spinner className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" aria-hidden />}Submit count</Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}
