"use client";

/**
 * Create RMA → Return shipping: the Logiwa "Return" section. Return address (warehouse / client
 * return addresses) always; when no label is bought, the manual Return carrier, Return
 * shipping option, Return shipping cost and Return tracking number(s) (several, with Add) for
 * customer-supplied or marketplace labels.
 */
import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/lib/query-client";
import type { CarrierOption, ReturnAddressOption } from "./return-types";
import { addTrackingNumber, MAX_TRACKING_NUMBERS, returnCostError, type ReturnInfoValue } from "./rma-form";

/** Carriers always offered for a manual return (customer or marketplace labels), plus the warehouse's connections. */
export const COMMON_RETURN_CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "OnTrac", "Amazon Shipping", "Other"] as const;

export function manualCarrierOptions(connections: readonly Pick<CarrierOption, "carrierCode">[]): readonly string[] {
  const seen = new Map<string, string>();
  for (const c of [...connections.map((x) => x.carrierCode), ...COMMON_RETURN_CARRIERS]) if (c && !seen.has(c.toUpperCase())) seen.set(c.toUpperCase(), c);
  const other = [...seen.values()].filter((c) => c !== "Other");
  return [...other, "Other"];
}

function Field({ id, label, hint, error, children }: { readonly id: string; readonly label: string; readonly hint?: string; readonly error?: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-body">{label}</label>
      {children}
      {error ? <p className="text-[11px] text-danger">{error}</p> : hint ? <p className="text-[11px] text-secondary">{hint}</p> : null}
    </div>
  );
}

export function ReturnAddressField({ options, value, onChange }: { readonly options: readonly ReturnAddressOption[]; readonly value: string | null; readonly onChange: (id: string | null) => void }) {
  return (
    <Field id="rma-return-address" label="Return address" hint={options.length ? "Where the customer sends the items. Printed on the return label." : "No warehouse or client return address is set up. The warehouse address is used."}>
      <Select id="rma-return-address" value={value} disabled={options.length === 0} onChange={onChange} placeholder={options.length ? "Choose a return address" : "Warehouse address"}
        options={options.map((a) => ({ value: a.id, label: a.label, textValue: `${a.label} ${a.description}`, description: a.description, group: a.owner === "warehouse" ? "Warehouse" : "Client return addresses" }))} />
    </Field>
  );
}

export function ManualReturnInfoFields({ warehouseId, clientId, value, onChange, errors = {} }: {
  readonly warehouseId: string; readonly clientId: string; readonly value: ReturnInfoValue; readonly onChange: (v: ReturnInfoValue) => void;
  readonly errors?: Partial<Record<"shippingCost" | "trackingNumbers", string>>;
}) {
  const carriers = useApiQuery<readonly CarrierOption[]>(["returns", "carriers", warehouseId, clientId], "/api/returns/carriers", { query: { warehouseId, clientId } });
  const connections = carriers.data?.data ?? [];
  const carrierList = manualCarrierOptions(connections);
  const services = [...new Set(connections.filter((c) => c.carrierCode.toUpperCase() === (value.carrierCode ?? "").toUpperCase()).flatMap((c) => c.services.map((s) => s.name)))].sort();
  const [draft, setDraft] = React.useState("");
  const [trackErr, setTrackErr] = React.useState<string | null>(null);
  const costError = errors.shippingCost ?? returnCostError(value.shippingCost) ?? undefined;
  const add = () => {
    const out = addTrackingNumber(value.trackingNumbers, draft);
    setTrackErr(out.error);
    if (!out.error) { onChange({ ...value, trackingNumbers: out.list }); setDraft(""); }
  };
  return (
    <div className="grid gap-3" data-testid="rma-manual-return-info">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id="rma-ri-carrier" label="Return carrier">
          <Select id="rma-ri-carrier" value={value.carrierCode} clearable placeholder={carriers.isPending ? "Loading carriers…" : "Choose a carrier"}
            options={carrierList.map((c) => ({ value: c, label: c }))} onChange={(c) => onChange({ ...value, carrierCode: c, carrierServiceName: c === value.carrierCode ? value.carrierServiceName : "" })} />
        </Field>
        <Field id="rma-ri-service" label="Return shipping option" hint={services.length ? undefined : "Free text, e.g. Ground"}>
          {services.length ? (
            <Select id="rma-ri-service" value={value.carrierServiceName || null} clearable placeholder="Choose an option" options={services.map((s) => ({ value: s, label: s }))} onChange={(s) => onChange({ ...value, carrierServiceName: s ?? "" })} />
          ) : (
            <Input id="rma-ri-service" value={value.carrierServiceName} maxLength={120} disabled={!value.carrierCode} placeholder={value.carrierCode ? "Shipping option" : "Choose a carrier first"} onChange={(e) => onChange({ ...value, carrierServiceName: e.target.value })} />
          )}
        </Field>
        <Field id="rma-ri-cost" label="Return shipping cost" error={costError}>
          {/* No min clamp: a negative entry is shown as an error instead of being silently changed to 0. */}
          <NumberInput id="rma-ri-cost" value={value.shippingCost} max={100_000} decimals={2} hideStepper suffix={<span className="text-[11px] text-secondary">USD</span>} placeholder="0.00" invalid={Boolean(costError)} aria-invalid={costError ? true : undefined} onChange={(n) => onChange({ ...value, shippingCost: n })} />
        </Field>
      </div>
      <Field id="rma-ri-tracking" label={`Return tracking number(s)`} error={trackErr ?? errors.trackingNumbers} hint={`Up to ${MAX_TRACKING_NUMBERS}. Enter adds the number; scanners work too.`}>
        <div className="flex gap-2">
          <Input id="rma-ri-tracking" value={draft} maxLength={60} placeholder="Scan or type a tracking number" aria-invalid={trackErr ? true : undefined}
            onChange={(e) => { setDraft(e.target.value); if (trackErr) setTrackErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            // A number typed but not added is added on blur (a duplicate says so instead of vanishing).
            onBlur={() => { if (draft.trim()) add(); }} />
          <Button variant="secondary" onClick={add} disabled={!draft.trim()}><Plus className="h-3.5 w-3.5" aria-hidden />Add</Button>
        </div>
      </Field>
      {value.trackingNumbers.length ? (
        <ul aria-label="Return tracking numbers" className="flex flex-wrap gap-1.5">
          {value.trackingNumbers.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 font-mono text-[12px]">
              {t}
              <button type="button" aria-label={`Remove tracking number ${t}`} className="rounded-full p-0.5 text-secondary hover:bg-neutral-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => onChange({ ...value, trackingNumbers: value.trackingNumbers.filter((x) => x !== t) })}><X className="h-3 w-3" aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
