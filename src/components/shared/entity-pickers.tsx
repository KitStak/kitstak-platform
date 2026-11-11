"use client";

/**
 * Entity pickers (BUILD_PLAN F4.4). Async pickers search `GET /api/pickers/<kind>?q=&…`
 * (scoped server-side; F7 contract: `[{ id, label, description? , …extra }]`), with the
 * shared 3-character minimum. Org pickers read the user's scope from `/api/me`.
 *
 *   WarehouseSelect · ClientSelect · UserPicker · CustomerPicker · VendorPicker · JobPicker
 *   LocationPicker (area type, scan) · LpPicker · LocationOrLpPicker
 *   CarrierServiceSelect (cascading) · ShipmentPackageSelect · LookupSelect(type)
 */
import * as React from "react";
import { z } from "zod";
import { ScanLine } from "lucide-react";
import { AREA_TYPES } from "@/lib/enums";
import { apiFetch, type QueryValue } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { useBarcodeScanner } from "@/lib/scan";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tooltip } from "@/components/ui/tooltip";
import { parseList, pickerItemSchema, type PickerItem } from "./contracts";

export const PICKER_KINDS = ["locations", "lps", "users", "products", "customers", "vendors", "orders", "jobs", "carrier-services", "shipment-packages"] as const;
export type PickerKind = (typeof PICKER_KINDS)[number];
export const PICKER_LIMIT = 50;

export function toOption(item: PickerItem): ComboboxOption {
  return { value: item.id, label: item.label, ...(item.description ? { description: item.description } : {}) };
}

export async function searchPicker(kind: PickerKind, q: string, params: Readonly<Record<string, QueryValue>> = {}, signal?: AbortSignal): Promise<readonly PickerItem[]> {
  const data = await apiFetch<unknown>(`/api/pickers/${kind}`, { query: { q, limit: PICKER_LIMIT, ...params }, signal });
  return parseList(pickerItemSchema, data);
}

interface BasePickerProps {
  readonly value: string | null;
  readonly onChange: (value: string | null, item: ComboboxOption | null) => void;
  /** Label for the current value when it is not in the latest results. */
  readonly selectedLabel?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly id?: string;
  readonly onBlur?: () => void;
  readonly "aria-label"?: string;
  readonly clearable?: boolean;
}

function AsyncPicker({ kind, params, minChars, ...props }: BasePickerProps & { readonly kind: PickerKind; readonly params?: Readonly<Record<string, QueryValue>>; readonly minChars?: number }) {
  const paramsKey = JSON.stringify(params ?? {});
  const loadOptions = React.useCallback(
    async (q: string, signal: AbortSignal) => (await searchPicker(kind, q, JSON.parse(paramsKey) as Record<string, QueryValue>, signal)).map(toOption),
    [kind, paramsKey]
  );
  return (
    <Combobox
      id={props.id}
      aria-label={props["aria-label"]}
      loadOptions={loadOptions}
      minChars={minChars}
      selectedOptions={props.value && props.selectedLabel ? [{ value: props.value, label: props.selectedLabel }] : undefined}
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder ?? "Search…"}
      disabled={props.disabled}
      invalid={props.invalid}
      onBlur={props.onBlur}
      clearable={props.clearable ?? true}
    />
  );
}

/* ---------------- org ---------------- */

export function WarehouseSelect(props: BasePickerProps) {
  const me = useMe();
  const options = (me.data?.data.contextOptions.warehouses ?? []).map((w) => ({ value: w.id, label: w.code ? `${w.code} · ${w.name}` : w.name }));
  return <Combobox id={props.id} aria-label={props["aria-label"] ?? "Warehouse"} options={options} value={props.value} onChange={props.onChange} placeholder={props.placeholder ?? "Select warehouse"} disabled={props.disabled || me.isPending} invalid={props.invalid} onBlur={props.onBlur} clearable={props.clearable} />;
}

/** Clients in the user's scope; with `warehouseId`, narrowed through the client picker endpoint. */
export function ClientSelect({ warehouseId, ...props }: BasePickerProps & { readonly warehouseId?: string | null }) {
  const me = useMe();
  const scoped = useApiQuery<unknown>(["picker-clients", warehouseId ?? ""], warehouseId ? "/api/clients" : null, { query: { "f.warehouseId": `in:${warehouseId ?? ""}`, ps: 1000 }, retry: false });
  const fromWarehouse = z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullish() })).safeParse(scoped.data?.data);
  const base = me.data?.data.contextOptions.clients ?? [];
  const allowed = warehouseId && fromWarehouse.success ? new Set(fromWarehouse.data.map((c) => c.id)) : null;
  const options = base.filter((c) => !allowed || allowed.has(c.id)).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
  return <Combobox id={props.id} aria-label={props["aria-label"] ?? "Client"} options={options} value={props.value} onChange={props.onChange} placeholder={props.placeholder ?? "Select client"} disabled={props.disabled || me.isPending} invalid={props.invalid} onBlur={props.onBlur} clearable={props.clearable} emptyText="No clients for this warehouse" />;
}

export function UserPicker({ warehouseId, ...props }: BasePickerProps & { readonly warehouseId?: string | null }) {
  return <AsyncPicker kind="users" minChars={0} params={{ warehouseId }} placeholder="Search users" aria-label="User" {...props} />;
}

export function CustomerPicker({ clientId, ...props }: BasePickerProps & { readonly clientId?: string | null }) {
  return <AsyncPicker kind="customers" params={{ clientId }} placeholder="Search customers" aria-label="Customer" {...props} />;
}

export function VendorPicker({ clientId, ...props }: BasePickerProps & { readonly clientId?: string | null }) {
  return <AsyncPicker kind="vendors" params={{ clientId }} placeholder="Search vendors" aria-label="Vendor" {...props} />;
}

export function JobPicker({ status, jobTypeId, ...props }: BasePickerProps & { readonly status?: readonly string[]; readonly jobTypeId?: string | null }) {
  return <AsyncPicker kind="jobs" params={{ status: status?.join(","), jobTypeId }} placeholder="Search job code" aria-label="Job" {...props} />;
}

/* ---------------- location / LP ---------------- */

type AreaType = (typeof AREA_TYPES)[number];

/** Scan button: arms a keyboard-wedge listener and resolves the scanned code to a record. */
function ScanButton({ kind, params, onResolved, disabled }: { readonly kind: PickerKind; readonly params?: Readonly<Record<string, QueryValue>>; readonly onResolved: (item: PickerItem | null, code: string) => void; readonly disabled?: boolean }) {
  const [armed, setArmed] = React.useState(false);
  const resolve = React.useCallback(
    (code: string) => {
      setArmed(false);
      searchPicker(kind, code, { ...params, exact: true })
        .then((items) => onResolved(items[0] ?? null, code))
        .catch(() => onResolved(null, code));
    },
    [kind, params, onResolved]
  );
  useBarcodeScanner(resolve, { enabled: armed, allowInInputs: true });
  return (
    <Tooltip content={armed ? "Scan now… (click to cancel)" : "Scan a barcode"}>
      <button type="button" aria-pressed={armed} aria-label="Scan barcode" disabled={disabled} onClick={() => setArmed(!armed)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 disabled:opacity-45 ${armed ? "animate-pulse border-primary bg-primary-soft text-primary" : "border-border-strong/70 text-secondary hover:bg-surface-sunken"}`}>
        <ScanLine className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}

export interface LocationPickerProps extends BasePickerProps {
  readonly warehouseId?: string | null;
  readonly areaTypes?: readonly AreaType[];
  readonly scan?: boolean;
  readonly onScanMiss?: (code: string) => void;
}

export function LocationPicker({ warehouseId, areaTypes, scan = true, onScanMiss, ...props }: LocationPickerProps) {
  const params = { warehouseId, areaType: areaTypes?.join(",") };
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <AsyncPicker kind="locations" params={params} placeholder="Search location" aria-label="Location" {...props} />
      </div>
      {scan ? <ScanButton kind="locations" params={params} disabled={props.disabled} onResolved={(item, code) => (item ? props.onChange(item.id, toOption(item)) : onScanMiss?.(code))} /> : null}
    </div>
  );
}

export function LpPicker({ warehouseId, scan = true, onScanMiss, ...props }: BasePickerProps & { readonly warehouseId?: string | null; readonly scan?: boolean; readonly onScanMiss?: (code: string) => void }) {
  const params = { warehouseId };
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <AsyncPicker kind="lps" params={params} placeholder="Search LP number" aria-label="License plate" {...props} />
      </div>
      {scan ? <ScanButton kind="lps" params={params} disabled={props.disabled} onResolved={(item, code) => (item ? props.onChange(item.id, toOption(item)) : onScanMiss?.(code))} /> : null}
    </div>
  );
}

export type LocationOrLp = { readonly kind: "location" | "lp"; readonly id: string } | null;

export function LocationOrLpPicker({ value, onChange, warehouseId, areaTypes, disabled }: { readonly value: LocationOrLp; readonly onChange: (value: LocationOrLp) => void; readonly warehouseId?: string | null; readonly areaTypes?: readonly AreaType[]; readonly disabled?: boolean }) {
  const [kind, setKind] = React.useState<"location" | "lp">(value?.kind ?? "location");
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl<"location" | "lp">
        size="sm"
        ariaLabel="Target type"
        value={kind}
        disabled={disabled}
        onChange={(k) => {
          setKind(k);
          onChange(null);
        }}
        options={[
          { value: "location", label: "Location" },
          { value: "lp", label: "License plate" },
        ]}
      />
      {kind === "location" ? (
        <LocationPicker warehouseId={warehouseId} areaTypes={areaTypes} disabled={disabled} value={value?.kind === "location" ? value.id : null} onChange={(id) => onChange(id ? { kind: "location", id } : null)} />
      ) : (
        <LpPicker warehouseId={warehouseId} disabled={disabled} value={value?.kind === "lp" ? value.id : null} onChange={(id) => onChange(id ? { kind: "lp", id } : null)} />
      )}
    </div>
  );
}

/* ---------------- shipping + lookups ---------------- */

const carrierServiceSchema = pickerItemSchema.and(z.object({ carrier: z.string(), carrierName: z.string().nullish() }));

export interface CarrierServiceValue {
  readonly carrier: string | null;
  readonly serviceId: string | null;
}

/** Carrier → Service cascade. Changing the carrier clears the service. */
export function CarrierServiceSelect({ value, onChange, clientId, disabled, invalid }: { readonly value: CarrierServiceValue; readonly onChange: (value: CarrierServiceValue) => void; readonly clientId?: string | null; readonly disabled?: boolean; readonly invalid?: boolean }) {
  const query = useApiQuery<unknown>(["picker", "carrier-services", clientId ?? ""], "/api/pickers/carrier-services", { query: { clientId: clientId ?? undefined, limit: 500 } });
  const services = parseList(carrierServiceSchema, query.data?.data);
  const carriers = [...new Map(services.map((s) => [s.carrier, s.carrierName ?? s.carrier])).entries()].map(([v, label]) => ({ value: v, label }));
  const serviceOptions = services.filter((s) => s.carrier === value.carrier).map((s) => ({ value: s.id, label: s.label, description: s.description ?? undefined }));
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select aria-label="Carrier" placeholder={query.isPending ? "Loading…" : "Select carrier"} options={carriers} value={value.carrier} disabled={disabled || query.isPending} invalid={invalid} onChange={(carrier) => onChange({ carrier, serviceId: null })} />
      <Select aria-label="Carrier service" placeholder={value.carrier ? "Select service" : "Choose a carrier first"} options={serviceOptions} value={value.serviceId} disabled={disabled || !value.carrier} invalid={invalid} onChange={(serviceId) => onChange({ ...value, serviceId })} />
    </div>
  );
}

export function ShipmentPackageSelect({ warehouseId, ...props }: BasePickerProps & { readonly warehouseId?: string | null }) {
  const query = useApiQuery<unknown>(["picker", "shipment-packages", warehouseId ?? ""], "/api/pickers/shipment-packages", { query: { warehouseId: warehouseId ?? undefined, limit: 500 } });
  const options = parseList(pickerItemSchema, query.data?.data).map(toOption);
  return <Combobox id={props.id} aria-label={props["aria-label"] ?? "Shipment package"} options={options} value={props.value} onChange={props.onChange} placeholder={query.isPending ? "Loading…" : (props.placeholder ?? "Select package")} disabled={props.disabled || query.isPending} invalid={props.invalid} onBlur={props.onBlur} clearable={props.clearable} />;
}

const lookupSchema = z.object({ id: z.string(), name: z.string().optional(), value: z.string().optional(), label: z.string().optional(), isActive: z.boolean().optional() });

/** Data Setup lookup values (`GET /api/lookups/[type]`). */
export function LookupSelect({ type, clientId, ...props }: BasePickerProps & { readonly type: string; readonly clientId?: string | null }) {
  const query = useApiQuery<unknown>(["lookups", type, clientId ?? ""], `/api/lookups/${encodeURIComponent(type)}`, { query: { clientId: clientId ?? undefined } });
  const options = parseList(lookupSchema, query.data?.data)
    .filter((l) => l.isActive !== false)
    .map((l) => ({ value: l.id, label: l.label ?? l.name ?? l.value ?? l.id }));
  return <Combobox id={props.id} aria-label={props["aria-label"] ?? type} options={options} value={props.value} onChange={props.onChange} placeholder={query.isPending ? "Loading…" : (props.placeholder ?? "Select")} disabled={props.disabled || query.isPending} invalid={props.invalid} onBlur={props.onBlur} clearable={props.clearable} />;
}
