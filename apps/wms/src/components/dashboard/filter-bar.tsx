"use client";

/**
 * Dashboard "Filter by" bar (spec 08 §Dashboard): Warehouse and Client multi-selects,
 * each with a search box, checkbox list and Add Filter (disabled until something
 * changed). The selection lives in the URL (`?wh=…&cl=…`) and defaults to the header
 * context, so a filtered dashboard is a shareable link.
 */
import * as React from "react";
import { ChevronDown, Filter, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterOption {
  readonly id: string;
  readonly label: string;
}

export function MultiSelect({ label, options, value, onApply }: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly value: readonly string[];
  readonly onApply: (next: readonly string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<readonly string[]>(value);
  const [term, setTerm] = React.useState("");
  // Reset the draft only when the popover opens or the applied selection really changes.
  // Keyed by content, not identity: the parent rebuilds `value` on every render (60 s
  // auto-refresh, header context), which used to wipe a half-made selection.
  const valueKey = value.join(",");
  React.useEffect(() => { if (open) { setDraft(valueKey ? valueKey.split(",") : []); setTerm(""); } }, [open, valueKey]);
  const dirty = draft.length !== value.length || draft.some((d) => !value.includes(d));
  const shown = options.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase()));
  const selectedLabels = options.filter((o) => value.includes(o.id)).map((o) => o.label);
  const summary = selectedLabels.length === 0 ? `All ${label.toLowerCase()}s` : selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels[0]} +${selectedLabels.length - 1}`;
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${summary}`}
          className={cn(
            "inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-md border bg-surface px-2.5 text-xs transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            value.length > 0 ? "border-primary/40 text-foreground" : "border-border text-secondary",
          )}
        >
          <span className="text-faint">{label}:</span>
          <span className="truncate font-medium">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
            <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search filter" aria-label={`Search ${label.toLowerCase()}s`} className="h-8 pl-8" />
          </div>
        </div>
        <ul role="listbox" aria-multiselectable aria-label={label} className="max-h-[260px] overflow-auto py-1">
          {shown.length === 0 ? <li className="px-3 py-2 text-xs text-faint">No matches</li> : null}
          {shown.map((o) => (
            <li key={o.id} role="option" aria-selected={draft.includes(o.id)}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-primary/5">
                <Checkbox checked={draft.includes(o.id)} onCheckedChange={() => toggle(o.id)} aria-label={o.label} />
                <span className="truncate">{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t border-border p-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft([])} disabled={draft.length === 0}>Clear</Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => { onApply(draft); setOpen(false); }}>Add Filter</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface DashboardFilterBarProps {
  readonly warehouses: readonly FilterOption[];
  readonly clients: readonly FilterOption[];
  readonly warehouseIds: readonly string[];
  readonly clientIds: readonly string[];
  readonly onChange: (next: { warehouseIds: readonly string[]; clientIds: readonly string[] }) => void;
}

export function DashboardFilterBar({ warehouses, clients, warehouseIds, clientIds, onChange }: DashboardFilterBarProps) {
  const active = warehouseIds.length + clientIds.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard filters">
      <span className="inline-flex items-center gap-1 text-2xs font-semibold text-faint"><Filter className="h-3.5 w-3.5" aria-hidden />Filter by</span>
      <MultiSelect label="Warehouse" options={warehouses} value={warehouseIds} onApply={(w) => onChange({ warehouseIds: w, clientIds })} />
      <MultiSelect label="Client" options={clients} value={clientIds} onApply={(c) => onChange({ warehouseIds, clientIds: c })} />
      {active ? (
        <button type="button" onClick={() => onChange({ warehouseIds: [], clientIds: [] })} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-secondary hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <X className="h-3.5 w-3.5" aria-hidden />Reset
        </button>
      ) : null}
    </div>
  );
}
