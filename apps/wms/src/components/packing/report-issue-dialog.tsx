"use client";

/**
 * Report Issue (Other Actions): moves picked stock of the order to a hospital location
 * (allocation kept) and sets Pack Short Status to Open. The operator chooses which
 * items and how many units go (default: everything not yet scanned into a package).
 * Hospital location and a description of the issue are required. Only designated hospitals are
 * offered (Location Group "Hospital" or HOSP* code); with none, the dialog says so and links to Locations.
 */
import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { ItemThumb } from "@/components/returns/return-items";
import { errorText } from "@/components/returns/returns-client";
import { defaultIssueQty, issueLinesPayload, type IssueLine } from "./pack-model";

interface Hospital { readonly id: string; readonly code: string; readonly detail: string; readonly isDefault: boolean }

const LOADING = "__loading__";

export function ReportIssueDialog({ open, onOpenChange, orderId, orderCode, warehouseId, defaultLocationId, defaultHospital = null, lines = [], onDone }: {
  readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly orderId: string; readonly orderCode: string; readonly warehouseId: string;
  readonly defaultLocationId: string | null; readonly defaultHospital?: Hospital | null; readonly lines?: readonly IssueLine[]; readonly onDone: () => void;
}) {
  const hospitals = useApiQuery<readonly Hospital[]>(["packing", "hospitals", warehouseId], open ? "/api/packing/hospitals" : null, { query: { warehouseId }, staleTime: 60_000 });
  const [locationId, setLocationId] = React.useState<string | null>(defaultLocationId);
  const [note, setNote] = React.useState("");
  const [qty, setQty] = React.useState<Readonly<Record<string, number | null>>>({});
  const [errors, setErrors] = React.useState<{ location?: string; note?: string; qty?: string }>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const linesKey = lines.map((l) => `${l.orderLineId}:${l.toPack}:${l.packed}`).join("|");
  React.useEffect(() => {
    if (!open) return;
    setLocationId(defaultLocationId); setNote(""); setErrors({}); setError(null);
    setQty(Object.fromEntries(lines.map((l) => [l.orderLineId, defaultIssueQty(l)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens or the lines change
  }, [open, defaultLocationId, linesKey]);

  // The default hospital is known from the pack context, so it shows at once; the full list
  // streams in behind it with a visible loading row instead of "No options".
  const loaded = hospitals.data?.data;
  const base: readonly Hospital[] = loaded ?? (defaultHospital ? [defaultHospital] : []);
  const options: SelectOption<string>[] = base.map((h) => ({ value: h.id, label: h.isDefault ? `${h.code} (default)` : h.code, textValue: h.code, description: h.detail }));
  // Never render a chosen id as a blank field: keep a labelled option for it until the list arrives.
  if (locationId && locationId !== LOADING && !base.some((h) => h.id === locationId)) options.unshift({ value: locationId, label: "Default hospital location", description: "Loading its code…" });
  if (hospitals.isPending) options.push({ value: LOADING, label: "Loading hospital locations…", disabled: true });
  if (hospitals.error) options.push({ value: LOADING, label: "Could not load the hospital locations", disabled: true });
  const chosen = base.find((h) => h.id === locationId) ?? null;
  // Hospitals are explicitly designated (Location Group "Hospital" or HOSP* code). None → say so.
  const noHospital = Boolean(loaded) && loaded!.length === 0 && !defaultHospital;

  const payloadLines = issueLinesPayload(lines, qty);
  const totalUnits = payloadLines.reduce((s, l) => s + l.qty, 0);

  const submit = async () => {
    const e = {
      location: noHospital ? "No hospital location is configured in this warehouse" : locationId ? undefined : "Choose the hospital location",
      note: note.trim() ? undefined : "Describe the issue",
      qty: lines.length > 0 && totalUnits === 0 ? "Choose at least one unit to move" : undefined,
    };
    setErrors(e);
    if (e.location || e.note || e.qty) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiRequest<{ movedUnits: number; hospitalCode: string; packShortStatus: string }>("/api/packing/report-issue", {
        method: "POST", body: { orderId, hospitalLocationId: locationId, note: note.trim(), ...(lines.length ? { lines: payloadLines } : {}) },
      });
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
      <DialogContent size="lg">
        <DialogHeader title={`Report issue on ${orderCode}`} description="The units you choose move to the hospital location and the order is flagged Pack Short: Open for follow-up." />
        <DialogBody className="space-y-4">
          {noHospital ? (
            <Callout variant="attention" title="No hospital location configured">
              This warehouse has no hospital location, so the stock has nowhere to go. In <Link href="/locations" className="font-medium text-primary hover:underline">Facility › Locations</Link>, put a location in the &quot;Hospital&quot; location group or code it HOSP… (e.g. HOSP-01), then report the issue again.
            </Callout>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="ri-loc" className="text-xs font-medium text-body">Hospital location <span className="text-danger">*</span></label>
            <Select id="ri-loc" value={locationId} invalid={Boolean(errors.location)} onChange={(v) => { if (v === LOADING) return; setLocationId(v); setErrors((x) => ({ ...x, location: undefined })); }}
              placeholder={hospitals.isPending && !defaultHospital ? "Loading hospital locations…" : noHospital ? "No hospital location configured" : "Choose a hospital location"} disabled={noHospital} options={options} />
            {chosen ? <p className="text-2xs text-secondary">Stock goes to <strong className="text-body">{chosen.code}</strong> · {chosen.detail}</p> : null}
            {errors.location ? <p className="text-2xs text-danger">{errors.location}</p> : null}
          </div>

          {lines.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-medium text-body">Units to move <span className="font-normal text-secondary">(defaults to what is not packed yet)</span></legend>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
                    <tr><th className="w-10 px-2 py-1.5" /><th className="px-2 py-1.5 text-left">Product</th><th className="px-2 py-1.5 text-right">Picked</th><th className="px-2 py-1.5 text-right">Packed</th><th className="w-[120px] px-2 py-1.5 text-right">Move</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.orderLineId} className="border-t border-border">
                        <td className="px-2 py-1"><ItemThumb url={l.imageUrl} size={28} /></td>
                        <td className="px-2 py-1.5"><span className="block font-medium">{l.sku}</span><span className="block max-w-[260px] truncate text-2xs text-secondary">{l.name}</span></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.toPack}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-secondary">{l.packed}</td>
                        <td className="px-2 py-1">
                          <NumberInput aria-label={`Units of ${l.sku} to move`} value={qty[l.orderLineId] ?? 0} min={0} max={l.toPack} className="ml-auto w-[104px]"
                            onChange={(n) => { setQty((q) => ({ ...q, [l.orderLineId]: n })); setErrors((x) => ({ ...x, qty: undefined })); }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={errors.qty ? "text-2xs text-danger" : "text-2xs text-secondary"}>{errors.qty ?? `${totalUnits} unit${totalUnits === 1 ? "" : "s"} will move to the hospital location.`}</p>
            </fieldset>
          ) : null}

          <div className="flex flex-col gap-1">
            <label htmlFor="ri-note" className="text-xs font-medium text-body">What is wrong? <span className="text-danger">*</span></label>
            <Textarea id="ri-note" rows={3} maxLength={500} value={note} aria-invalid={errors.note ? true : undefined}
              onChange={(e) => { setNote(e.target.value); if (e.target.value.trim()) setErrors((x) => ({ ...x, note: undefined })); }} placeholder="e.g. Item damaged in the tote, wrong color picked" />
            {errors.note ? <p className="text-2xs text-danger">{errors.note}</p> : null}
          </div>
          {error ? <Callout variant="error" title="Not reported">{error}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={saving || noHospital} title={noHospital ? "Configure a hospital location first" : undefined}>{saving ? <Spinner className="h-3.5 w-3.5" label="Reporting" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}Report issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
