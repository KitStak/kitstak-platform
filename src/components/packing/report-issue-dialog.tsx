"use client";

/**
 * Report Issue (Other Actions): moves the order's picked stock to a hospital location
 * (allocation kept) and sets Pack Short Status to Open. Hospital location and a
 * description of the issue are required.
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { errorText } from "@/components/returns/returns-client";

interface Hospital { readonly id: string; readonly code: string; readonly detail: string; readonly isDefault: boolean }

export function ReportIssueDialog({ open, onOpenChange, orderId, orderCode, warehouseId, defaultLocationId, onDone }: {
  readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly orderId: string; readonly orderCode: string; readonly warehouseId: string; readonly defaultLocationId: string | null; readonly onDone: () => void;
}) {
  const hospitals = useApiQuery<readonly Hospital[]>(["packing", "hospitals", warehouseId], open ? "/api/packing/hospitals" : null, { query: { warehouseId } });
  const [locationId, setLocationId] = React.useState<string | null>(defaultLocationId);
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ location?: string; note?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) { setLocationId(defaultLocationId); setNote(""); setErrors({}); setError(null); }
  }, [open, defaultLocationId]);

  const submit = async () => {
    const e = { location: locationId ? undefined : "Choose the hospital location", note: note.trim() ? undefined : "Describe the issue" };
    setErrors(e);
    if (e.location || e.note) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiRequest<{ movedUnits: number; hospitalCode: string; packShortStatus: string }>("/api/packing/report-issue", { method: "POST", body: { orderId, hospitalLocationId: locationId, note: note.trim() } });
      toast.success("Issue reported", `${data.movedUnits} unit${data.movedUnits === 1 ? "" : "s"} of ${orderCode} moved to ${data.hospitalCode}. Pack short status: ${data.packShortStatus}.`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(errorText(err, "The issue could not be reported."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title={`Report issue on ${orderCode}`} description="The picked items move to the hospital location and the order is flagged Pack Short: Open for follow-up." />
        <DialogBody className="space-y-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="ri-loc" className="text-[12px] font-medium text-body">Hospital location <span className="text-danger">*</span></label>
            <Select id="ri-loc" value={locationId} invalid={Boolean(errors.location)} onChange={setLocationId} placeholder={hospitals.isPending ? "Loading…" : "Choose a location"}
              options={(hospitals.data?.data ?? []).map((h) => ({ value: h.id, label: h.isDefault ? `${h.code} (default)` : h.code, textValue: h.code, description: h.detail }))} />
            {errors.location ? <p className="text-[11px] text-danger">{errors.location}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ri-note" className="text-[12px] font-medium text-body">What is wrong? <span className="text-danger">*</span></label>
            <Textarea id="ri-note" rows={3} maxLength={500} value={note} aria-invalid={errors.note ? true : undefined} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Item damaged in the tote, wrong color picked" />
            {errors.note ? <p className="text-[11px] text-danger">{errors.note}</p> : null}
          </div>
          {error ? <Callout variant="error" title="Not reported">{error}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={saving}>{saving ? <Spinner className="h-3.5 w-3.5" label="Reporting" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}Report issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
