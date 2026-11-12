"use client";

/** Advanced-step modals: inventory channel allocation and per-warehouse replenishment levels. */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import type { ChannelAllocationFormValue } from "@/lib/grid-defs/products/product-form";
import { useProductWizard } from "./context";

function Row({ label, required, info, error, children }: { readonly label: string; readonly required?: boolean; readonly info?: string; readonly error?: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel required={required} info={info}>{label}</FieldLabel>
      {children}
      <FieldError id={`err-${label}`} message={error} />
    </div>
  );
}

export function AllocationModal({ open, initial, onOpenChange, onSave, takenChannelIds }: { readonly open: boolean; readonly initial: ChannelAllocationFormValue; readonly onOpenChange: (o: boolean) => void; readonly onSave: (v: ChannelAllocationFormValue) => void; readonly takenChannelIds: ReadonlySet<string> }) {
  const { options } = useProductWizard();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setV(initial);
      setErrors({});
    }
  }, [open, initial]);
  const save = () => {
    const next: Record<string, string> = {};
    if (!v.channelConnectionId) next.channel = "Select a sales channel setup";
    else if (takenChannelIds.has(`${v.channelConnectionId}:${v.warehouseId ?? ""}`)) next.channel = "This channel and warehouse already have an allocation";
    if (v.staticQty === null && v.reserveQty === null && v.allocationPct === null) next.qty = "Enter a static qty, or a reserve qty and/or allocation percentage";
    if (v.allocationPct !== null && v.allocationPct > 100) next.qty = "Allocation percentage is at most 100";
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave(v);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Add inventory channel allocation" description="Publish a fixed quantity, or hold back a reserve and publish a percentage of what's left." />
        <DialogBody className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Row label="Sales channel setup" required error={errors.channel}>
              <Select aria-label="Sales channel setup" value={v.channelConnectionId || null} onChange={(x) => setV({ ...v, channelConnectionId: x ?? "" })} placeholder={options.channels.length ? "Select a channel" : "This client has no sales channels"} options={options.channels.map((c) => ({ value: c.value, label: c.label, description: c.description }))} invalid={Boolean(errors.channel)} />
            </Row>
          </div>
          <div className="md:col-span-2">
            <Row label="Warehouse" info="Leave empty to apply across every warehouse">
              <Select aria-label="Warehouse" clearable placeholder="All warehouses" value={v.warehouseId} onChange={(x) => setV({ ...v, warehouseId: x })} options={options.warehouses.map((w) => ({ value: w.value, label: w.label }))} />
            </Row>
          </div>
          <Row label="Static qty" info="Always publish exactly this quantity">
            <NumberInput aria-label="Static qty" min={0} value={v.staticQty} onChange={(x) => setV({ ...v, staticQty: x })} />
          </Row>
          <Row label="Reserve qty" info="Held back from the channel">
            <NumberInput aria-label="Reserve qty" min={0} value={v.reserveQty} onChange={(x) => setV({ ...v, reserveQty: x })} />
          </Row>
          <Row label="Allocation percentage" error={errors.qty}>
            <NumberInput aria-label="Allocation percentage" min={0} max={100} decimals={2} suffix="%" value={v.allocationPct} onChange={(x) => setV({ ...v, allocationPct: x })} />
          </Row>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface LevelDraft {
  readonly warehouseIds: readonly string[];
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
}

export function ReplenishmentModal({ open, initial, editing, onOpenChange, onSave, takenWarehouseIds }: { readonly open: boolean; readonly initial: LevelDraft; readonly editing: boolean; readonly onOpenChange: (o: boolean) => void; readonly onSave: (v: LevelDraft) => void; readonly takenWarehouseIds: ReadonlySet<string> }) {
  const { options } = useProductWizard();
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setV(initial);
      setErrors({});
    }
  }, [open, initial]);
  const save = () => {
    const next: Record<string, string> = {};
    if (v.warehouseIds.length === 0) next.wh = "Select at least one warehouse";
    if ((v.maxLevel ?? 0) < (v.minLevel ?? 0)) next.max = "Max must be at least min";
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave(v);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={editing ? "Edit replenishment level" : "Add replenishment level"} description="Replenishment tasks top up pick locations between these levels." />
        <DialogBody className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Row label="Warehouse(s)" required error={errors.wh}>
              <Combobox multiple aria-label="Warehouses" value={v.warehouseIds} onChange={(x) => setV({ ...v, warehouseIds: x })} disabled={editing}
                options={options.warehouses.map((w) => ({ value: w.value, label: w.label, disabled: takenWarehouseIds.has(w.value) && !initial.warehouseIds.includes(w.value), description: takenWarehouseIds.has(w.value) && !initial.warehouseIds.includes(w.value) ? "Already has a level" : undefined }))} invalid={Boolean(errors.wh)} placeholder="Select warehouses" />
            </Row>
          </div>
          <Row label="Min. replenishment level"><NumberInput aria-label="Min level" min={0} value={v.minLevel} onChange={(x) => setV({ ...v, minLevel: x })} /></Row>
          <Row label="Max. replenishment level" error={errors.max}><NumberInput aria-label="Max level" min={0} value={v.maxLevel} onChange={(x) => setV({ ...v, maxLevel: x })} invalid={Boolean(errors.max)} /></Row>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
