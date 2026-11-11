"use client";

/** Param editors for one workflow action (carrier service, preset, priority, tag, warehouse, package, order type, note, users). */
import * as React from "react";
import { z } from "zod";
import { PRIORITIES } from "@/lib/enums";
import { useApiQuery } from "@/lib/query-client";
import { ACTION_PARAMS, type ActionParamDef, type WorkflowActionName } from "@/lib/grid-defs/integrations/workflows";
import { searchPicker, ShipmentPackageSelect, toOption, UserPicker } from "@/components/shared/entity-pickers";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { FieldError } from "@/components/ui/form/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useLookups, useWarehouseOptions } from "@/components/integrations/shared/shared";

const presetList = z.array(z.object({ id: z.string(), label: z.string() }));

function PresetSelect({ id, value, onChange, invalid, warehouseId, clientId }: { readonly id: string; readonly value: string | null; readonly onChange: (v: string | null) => void; readonly invalid: boolean; readonly warehouseId: string | null; readonly clientId: string | null }) {
  const q = useApiQuery<unknown>(["rs-options", warehouseId ?? "", clientId ?? ""], "/api/rate-shopping-presets/options", { query: { warehouseId: warehouseId ?? undefined, clientId: clientId ?? undefined }, staleTime: 30_000 });
  const parsed = presetList.safeParse(q.data?.data);
  const options = parsed.success ? parsed.data.map((p) => ({ value: p.id, label: p.label })) : [];
  return <Combobox id={id} aria-label="Rate shopping preset" options={options} value={value} onChange={(v) => onChange(v)} placeholder={q.isPending ? "Loading presets…" : "Select a preset"} invalid={invalid} emptyText="No active presets in this scope" clearable />;
}

function CarrierServicePicker({ id, value, onChange, invalid, warehouseId, clientId }: { readonly id: string; readonly value: string | null; readonly onChange: (v: string | null) => void; readonly invalid: boolean; readonly warehouseId: string | null; readonly clientId: string | null }) {
  const load = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("carrier-services", q, { warehouseId, clientId }, signal)).map(toOption), [warehouseId, clientId]);
  return <Combobox id={id} aria-label="Carrier service" loadOptions={load} minChars={0} value={value} onChange={(v) => onChange(v)} placeholder="Search carrier services" invalid={invalid} clearable />;
}

export function ActionParamField({ id, action, def, value, onChange, error, warehouseId, clientId }: {
  readonly id: string; readonly action: WorkflowActionName; readonly def: ActionParamDef; readonly value: unknown; readonly onChange: (v: unknown) => void;
  readonly error: string | null; readonly warehouseId: string | null; readonly clientId: string | null;
}) {
  const warehouses = useWarehouseOptions();
  const types = useLookups("so_type");
  const invalid = Boolean(error);
  const str = typeof value === "string" ? value : null;
  let control: React.ReactNode;
  switch (def.kind) {
    case "priority": control = <Select id={id} value={str} onChange={onChange} options={PRIORITIES.map((p) => ({ value: p, label: p }))} placeholder="Select priority" invalid={invalid} />; break;
    case "warehouse": control = <Select id={id} value={str} onChange={onChange} options={warehouses.options} placeholder="Select warehouse" invalid={invalid} />; break;
    case "order-type": control = <Select id={id} value={str} onChange={onChange} options={types.options} placeholder={types.loading ? "Loading…" : "Select order type"} invalid={invalid} />; break;
    case "preset": control = <PresetSelect id={id} value={str} onChange={onChange} invalid={invalid} warehouseId={warehouseId} clientId={clientId} />; break;
    case "carrier-service": control = <CarrierServicePicker id={id} value={str} onChange={onChange} invalid={invalid} warehouseId={warehouseId} clientId={clientId} />; break;
    case "package": control = <ShipmentPackageSelect id={id} warehouseId={warehouseId} value={str} onChange={(v) => onChange(v)} invalid={invalid} />; break;
    case "users": {
      const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
      control = (
        <div className="flex flex-col gap-1.5">
          <UserPicker id={id} value={null} warehouseId={warehouseId} placeholder="Add a user" onChange={(v) => { if (v && !list.includes(v)) onChange([...list, v]); }} invalid={invalid} />
          <UserChips ids={list} onRemove={(uid) => onChange(list.filter((x) => x !== uid))} />
        </div>
      );
      break;
    }
    case "textarea": control = <Textarea id={id} rows={2} maxLength={1000} value={str ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} invalid={invalid} />; break;
    default: control = <TextField id={id} maxLength={100} value={str ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} invalid={invalid} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-2xs font-medium text-secondary">{def.label}{def.required ? <span className="text-danger"> *</span> : null}</label>
      {control}
      <FieldError id={`${id}-error`} message={error ?? undefined} />
      {action === "Set Rate Shopping Preset" && !clientId ? <p className="text-2xs text-faint">Tip: scope the workflow to a client to list only its presets.</p> : null}
    </div>
  );
}

const userList = z.array(z.object({ id: z.string(), label: z.string() }));

function UserChips({ ids, onRemove }: { readonly ids: readonly string[]; readonly onRemove: (id: string) => void }) {
  const q = useApiQuery<unknown>(["user-labels", ids.join(",")], ids.length > 0 ? "/api/pickers/users" : null, { query: { ids: ids.join(","), limit: 50 }, staleTime: 60_000 });
  const parsed = userList.safeParse(q.data?.data);
  const label = new Map(parsed.success ? parsed.data.map((u) => [u.id, u.label]) : []);
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((uid) => (
        <li key={uid} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-medium text-primary">
          {label.get(uid) ?? "User"}
          <button type="button" aria-label={`Remove ${label.get(uid) ?? "user"}`} onClick={() => onRemove(uid)} className="rounded-full px-0.5 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">×</button>
        </li>
      ))}
    </ul>
  );
}

export const paramsFor = (action: WorkflowActionName) => ACTION_PARAMS[action];
