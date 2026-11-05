"use client";

import * as React from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/dropdown";

const WAREHOUSES = ["MLT1 – Main Fulfillment", "KS2 – Overflow"] as const;

const CLIENTS = [
  "All Clients",
  "Apex Threads Co.",
  "NovaForge Electronics",
  "Copperline Coffee Co.",
  "Bluebird & Main",
  "Voltbyte Labs",
  "Summit Trail Gear",
  "Harbor Roast Collective",
  "Pixel & Pine",
] as const;

function FilterSelect({
  value,
  placeholder,
  options,
  onSelect,
  widthClass,
}: {
  value: string | null;
  placeholder: string;
  options: readonly string[];
  onSelect: (value: string) => void;
  widthClass: string;
}) {
  return (
    <Dropdown
      align="start"
      panelClassName="max-h-64 overflow-y-auto"
      trigger={(open) => (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-8 items-center justify-between gap-2 rounded-md border bg-surface px-2.5 text-[12px] shadow-xs outline-none transition-colors",
            "border-border-strong/70 hover:border-border-strong hover:bg-surface-sunken",
            "focus-visible:ring-2 focus-visible:ring-primary/40",
            open && "border-primary/50 ring-2 ring-primary/20",
            widthClass
          )}
        >
          <span className={cn("truncate", value ? "font-medium text-body" : "text-faint")}>
            {value ?? placeholder}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-faint transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
      )}
    >
      {(close) => (
        <div role="listbox" aria-label={placeholder}>
          {options.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(option);
                  close();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-sunken",
                  selected ? "font-medium text-primary" : "text-body"
                )}
              >
                <span className="truncate">{option}</span>
                {selected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

/** Logiwa-style "Filter by [Warehouse] [Client]" context row for the dashboard. */
export function DashboardFilterBar() {
  const [warehouse, setWarehouse] = React.useState<string>(WAREHOUSES[0]);
  const [client, setClient] = React.useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-faint">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Filter by
      </span>
      <FilterSelect
        value={warehouse}
        placeholder="Warehouse"
        options={WAREHOUSES}
        onSelect={setWarehouse}
        widthClass="w-[196px]"
      />
      <FilterSelect
        value={client === "All Clients" ? null : client}
        placeholder="Client"
        options={CLIENTS}
        onSelect={(next) => setClient(next === "All Clients" ? null : next)}
        widthClass="w-[150px]"
      />
    </div>
  );
}
