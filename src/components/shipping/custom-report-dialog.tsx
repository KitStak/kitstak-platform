"use client";

/**
 * Print Custom Report (End Of The Day) — Logiwa parity: a standalone parameter dialog
 * (ship date range, carrier, warehouse, client) that works with or without a grid selection.
 * Selected manifests pre-fill the date range and carrier.
 */
import * as React from "react";
import { FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { EodRow } from "@/server/repositories/end-of-day";
import { fromYmd, initialCustomParams, ymd } from "./custom-report-params";
import { errorMessage, openFileWhenReady, postJson, useShippingFacets } from "./shipping-client";

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selected: readonly EodRow[];
}

export function CustomReportDialog({ open, onOpenChange, selected }: Props) {
  const facets = useShippingFacets().data?.data;
  const [range, setRange] = React.useState<DateRangeValue>({ from: null, to: null });
  const [carrier, setCarrier] = React.useState<string | null>(null);
  const [warehouse, setWarehouse] = React.useState<string | null>(null);
  const [client, setClient] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const init = initialCustomParams(selected);
    setRange({ from: fromYmd(init.from), to: fromYmd(init.to) });
    setCarrier(init.carrier);
    setWarehouse(null);
    setClient(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the dialog opens
  }, [open]);

  const valid = Boolean(range.from && range.to);

  const submit = async () => {
    if (!range.from || !range.to || busy) return;
    setBusy(true);
    try {
      await openFileWhenReady(() =>
        postJson<{ fileId: string | null }>("/api/end-of-day/print-custom", {
          from: ymd(range.from as Date), to: ymd(range.to as Date),
          ...(carrier ? { carrierCodes: [carrier] } : {}),
          ...(warehouse ? { warehouseCodes: [warehouse] } : {}),
          ...(client ? { clientName: client } : {}),
        }),
      );
      toast.success("Success", "Custom report ready to print.");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't print the custom report", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const opts = (list: readonly { value: string; label: string }[] | undefined) => (list ?? []).map((o) => ({ value: o.value, label: o.label }));

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="md">
        <DialogHeader title="Print custom report" description="Totals by client and service for every manifest in the range — open or closed." />
        <DialogBody className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-[12px] font-medium text-secondary">Ship date <span className="text-danger">*</span></span>
            <DateRangePicker value={range} onChange={(v) => setRange(v)} invalid={!valid} aria-label="Ship date range" />
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] font-medium text-secondary">Carrier</span>
            <Select options={opts(facets?.carriers)} value={carrier} onChange={setCarrier} placeholder="All carriers" clearable aria-label="Carrier" />
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] font-medium text-secondary">Warehouse</span>
            <Select options={opts(facets?.warehouses)} value={warehouse} onChange={setWarehouse} placeholder="All warehouses" clearable aria-label="Warehouse" />
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] font-medium text-secondary">Client</span>
            <Select options={opts(facets?.clients)} value={client} onChange={setClient} placeholder="All clients" clearable aria-label="Client" />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!valid || busy}>
            <FileBarChart className="h-4 w-4" aria-hidden />
            {busy ? "Printing…" : "Print report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
