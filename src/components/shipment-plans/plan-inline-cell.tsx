"use client";

/**
 * Inline edit for the truck columns of the Shipment Plan grid (Logiwa edits truck plate, gate and
 * loading times in place). A pencil on hover opens a small popover; Save PATCHes
 * `/api/shipment-plans/[id]/quick` with the row version, so a stale row gets the 409 Reload message.
 */
import * as React from "react";
import { PencilLine } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { editableLifecycleTimes, planEditBlockReason, type LifecycleTimeKey } from "@/lib/grid-defs/shipping/shipment-plans";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { dash, shipDateTime } from "@/components/shipping/column-kit";
import { GatePicker } from "./plan-form-controls";
import type { PlanRow } from "./plans-client";

export type InlineField = "truckPlateNumber" | "loadingGateLocationId" | Exclude<LifecycleTimeKey, "actualShipmentAt">;

const LABEL: Readonly<Record<InlineField, string>> = {
  truckPlateNumber: "Truck plate number", loadingGateLocationId: "Loading gate",
  loadingStartedAt: "Loading start date", loadingCompletedAt: "Loading complete date", truckDepartedAt: "Truck depart date",
};

/** ISO → value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function inlineEditBlockReason(row: PlanRow, field: InlineField): string | null {
  const blocked = planEditBlockReason(row.status);
  if (blocked) return blocked;
  if (field === "truckPlateNumber" || field === "loadingGateLocationId") return null;
  if (editableLifecycleTimes(row.status).has(field)) return null;
  return field === "loadingStartedAt" ? "Set when the plan reaches Loading Started" : "Set when the plan reaches Loading Completed";
}

export function PlanInlineCell({ row, field, canEdit, onSaved }: {
  readonly row: PlanRow;
  readonly field: InlineField;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
}) {
  const r = row as PlanRow & Record<string, unknown>;
  const isTime = field !== "truckPlateNumber" && field !== "loadingGateLocationId";
  const display = field === "loadingGateLocationId" ? (r.loadingGate as string | null) : isTime ? (r[field] ? shipDateTime(r[field] as string) : null) : (r[field] as string | null);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [gate, setGate] = React.useState<{ id: string | null; label: string }>({ id: null, label: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reason = canEdit ? inlineEditBlockReason(row, field) : null;
  const begin = (next: boolean) => {
    if (next) {
      setError(null);
      setText(isTime ? toLocalInput((r[field] as string | null) ?? null) : String(r[field] ?? ""));
      setGate({ id: (r.loadingGateLocationId as string | null) ?? null, label: (r.loadingGate as string | null) ?? "" });
    }
    setOpen(next);
  };

  const save = async () => {
    let value: string | null;
    if (field === "loadingGateLocationId") value = gate.id;
    else if (isTime) {
      if (!text) { setError(`${LABEL[field]} can't be cleared once recorded`); return; }
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) { setError("Enter a valid date and time"); return; }
      value = d.toISOString();
    } else value = text.trim() || null;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/shipment-plans/${encodeURIComponent(row.id)}/quick`, { method: "PATCH", body: { version: row.version, [field]: value } });
      toast.success(`${row.code}: ${LABEL[field].toLowerCase()} saved`);
      setOpen(false);
      onSaved();
    } catch (e) {
      const err = e as { message?: string; fieldErrors?: Record<string, string[]> };
      setError(err.fieldErrors?.[field]?.[0] ?? err.message ?? "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const shown = display ? <span className="block min-w-0 truncate" title={display}>{display}</span> : dash;
  if (!canEdit) return shown;
  const trigger = (
    <button
      type="button"
      aria-label={`Edit ${LABEL[field].toLowerCase()} of ${row.code}`}
      disabled={Boolean(reason)}
      onClick={(e) => e.stopPropagation()}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-secondary opacity-0 transition-colors hover:bg-surface-sunken hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 group-hover/inline:opacity-100 data-[state=open]:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 disabled:group-hover/inline:opacity-40 [@media(hover:none)]:opacity-100"
    >
      <PencilLine className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
  return (
    <span className="group/inline flex w-full min-w-0 items-center justify-between gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="min-w-0 flex-1">{shown}</span>
      {reason ? (
        <Tooltip content={reason}><span>{trigger}</span></Tooltip>
      ) : (
        <Popover open={open} onOpenChange={begin}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3" onKeyDown={(e) => { if (e.key === "Enter" && field !== "loadingGateLocationId") { e.preventDefault(); void save(); } }}>
            <label className="mb-1.5 block text-xs font-semibold text-primary" htmlFor={`inline-${row.id}-${field}`}>{LABEL[field]}</label>
            {field === "loadingGateLocationId" ? (
              <GatePicker id={`inline-${row.id}-${field}`} value={gate.id} selectedLabel={gate.label || undefined} warehouseId={row.warehouseId}
                placeholder="Search a dock or staging location" onChange={(v, item) => setGate({ id: v, label: item ? String(item.label) : "" })} />
            ) : (
              <input
                id={`inline-${row.id}-${field}`}
                type={isTime ? "datetime-local" : "text"}
                maxLength={isTime ? undefined : 40}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={Boolean(error)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 aria-[invalid=true]:border-danger"
              />
            )}
            {error ? <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
