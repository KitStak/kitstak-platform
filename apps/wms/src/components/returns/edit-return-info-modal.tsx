"use client";

/**
 * Edit Return info for one RMA (Logiwa order › Return section): Return carrier, Return shipping
 * option, Return shipping cost and Return tracking number(s) with Add row. Reuses the Create RMA
 * fields. Carrier is locked while a purchased return label is active (void it first).
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { ManualReturnInfoFields } from "./return-info-fields";
import type { ReturnDetail } from "./return-types";
import { returnCostError, type ReturnInfoValue } from "./rma-form";
import { errorText } from "./returns-client";

export function initialReturnInfo(r: Pick<ReturnDetail, "carrierCode" | "carrierServiceName" | "trackingNumbers" | "trackingNumber" | "returnShippingCost">): ReturnInfoValue {
  const list = r.trackingNumbers?.length ? [...r.trackingNumbers] : r.trackingNumber ? r.trackingNumber.split(",").map((t) => t.trim()).filter(Boolean) : [];
  return { carrierCode: r.carrierCode ?? null, carrierServiceName: r.carrierServiceName ?? "", shippingCost: r.returnShippingCost ?? null, trackingNumbers: list };
}

export function EditReturnInfoModal({ open, onOpenChange, detail, onDone }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly detail: ReturnDetail; readonly onDone: () => void }) {
  const [value, setValue] = React.useState<ReturnInfoValue>(() => initialReturnInfo(detail));
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<"shippingCost" | "trackingNumbers", string>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const save = async () => {
    const costErr = returnCostError(value.shippingCost);
    if (costErr) { setErrors({ shippingCost: costErr }); setError("Fix the highlighted field."); return; }
    setSaving(true); setError(null); setErrors({});
    try {
      await apiRequest(`/api/returns/${detail.id}/info`, { method: "PATCH", body: { carrierCode: value.carrierCode, carrierServiceName: value.carrierServiceName || null, shippingCost: value.shippingCost, trackingNumbers: value.trackingNumbers, version: detail.version } });
      toast.success("Return info saved", `${detail.rmaCode}: ${value.trackingNumbers.length} tracking number${value.trackingNumbers.length === 1 ? "" : "s"}`);
      onDone(); onOpenChange(false);
    } catch (e) {
      if (isApiError(e) && e.fieldErrors) setErrors({ shippingCost: e.fieldErrors.shippingCost?.[0], trackingNumbers: e.fieldErrors.trackingNumbers?.[0] });
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent size="lg">
        <DialogHeader title={`Edit return info · ${detail.rmaCode}`} description="Carrier, shipping option, cost and the tracking numbers the customer or marketplace gave you." />
        <DialogBody className="space-y-3">
          {detail.label && detail.label.labelStatus !== "Voided" ? <Callout variant="info" title="A return label is active">Tracking {detail.label.trackingNumber} comes from the purchased label. Void it to change the carrier.</Callout> : null}
          <ManualReturnInfoFields warehouseId={detail.warehouseId} clientId={detail.clientId} value={value} onChange={(v) => { setValue(v); if (errors.shippingCost && v.shippingCost !== value.shippingCost) { setErrors((e) => ({ ...e, shippingCost: undefined })); setError(null); } }} errors={errors} />
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}Save return info</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
