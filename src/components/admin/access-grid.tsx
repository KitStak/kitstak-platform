"use client";

/**
 * Access grid (Users wizard steps 2–4, Printout client access): search, tick a row to
 * assign it (selection IS assignment, no separate Assign step), an Access pill per row and
 * a Total / Assigned footer. Controlled: `value` holds the assigned ids.
 */
import * as React from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

export interface AccessItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string | null;
  readonly badge?: React.ReactNode;
}

export interface AccessGridProps {
  readonly items: readonly AccessItem[];
  readonly value: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly noun: string;
  readonly columnLabel: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** Toggle per row instead of the Assigned / Unassigned pill. */
  readonly toggles?: boolean;
  readonly loading?: boolean;
}

export function AccessGrid({ items, value, onChange, noun, columnLabel, disabled, invalid, describedBy, toggles = false, loading }: AccessGridProps) {
  const [search, setSearch] = React.useState("");
  const assigned = React.useMemo(() => new Set(value), [value]);
  const q = search.trim().toLowerCase();
  const visible = q ? items.filter((i) => i.label.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)) : items;
  const allVisibleAssigned = visible.length > 0 && visible.every((i) => assigned.has(i.id));
  const someAssigned = visible.some((i) => assigned.has(i.id));

  const setVisible = (assign: boolean) => {
    const next = new Set(assigned);
    for (const i of visible) {
      if (assign) next.add(i.id);
      else next.delete(i.id);
    }
    onChange([...next]);
  };
  const toggleOne = (id: string) => {
    const next = new Set(assigned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div className={cn("flex flex-col rounded-lg border bg-surface", invalid ? "border-danger" : "border-border")} aria-describedby={describedBy}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <label className="relative flex min-w-[200px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="sr-only">Search {noun}s</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search by ${noun}`}
            className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-[13px] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </label>
        {!toggles && visible.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={disabled || !someAssigned} onClick={() => setVisible(false)}><X className="h-3.5 w-3.5" aria-hidden />{q ? "Clear shown" : "Clear all"}</Button>
            <Button size="sm" variant="secondary" disabled={disabled || allVisibleAssigned} onClick={() => setVisible(true)}><Check className="h-3.5 w-3.5" aria-hidden />{q ? "Assign shown" : "Assign all"}</Button>
          </div>
        ) : null}
      </div>
      <div className={cn("overflow-auto", items.length > 10 && "max-h-[420px] [scrollbar-gutter:stable]")}>
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-[1] bg-surface-sunken text-left text-[10px] font-semibold uppercase tracking-wide text-faint">
            <tr>
              {!toggles ? (
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label={`Assign all ${noun}s`}
                    checked={allVisibleAssigned ? true : someAssigned ? "indeterminate" : false}
                    disabled={disabled || visible.length === 0}
                    onCheckedChange={() => setVisible(!allVisibleAssigned)}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">{columnLabel}</th>
              <th className="w-[130px] px-3 py-2">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-faint">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-faint">{q ? `No ${noun}s match "${search}"` : `No ${noun}s available`}</td></tr>
            ) : (
              visible.map((item) => {
                const on = assigned.has(item.id);
                return (
                  <tr key={item.id} className={cn("transition-colors hover:bg-neutral-soft/50", on && !toggles && "bg-primary-soft/30")}>
                    {!toggles ? (
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={`Assign ${item.label}`}
                          checked={on}
                          disabled={disabled}
                          onCheckedChange={() => toggleOne(item.id)}
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{item.label}</span>
                        {item.badge}
                      </span>
                      {item.description ? <span className="block text-[11px] text-faint">{item.description}</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {toggles ? (
                        <Switch checked={on} disabled={disabled} onCheckedChange={() => toggleOne(item.id)} aria-label={`${on ? "Remove" : "Give"} access for ${item.label}`} />
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleOne(item.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed",
                            on ? "bg-success-soft text-success hover:bg-success-soft/70" : "bg-neutral-soft text-neutral hover:bg-neutral-soft/70",
                          )}
                          aria-pressed={on}
                          aria-label={`${item.label}: ${on ? "assigned" : "unassigned"}. Click to ${on ? "unassign" : "assign"}`}
                        >
                          {on ? <Check className="h-3 w-3" aria-hidden /> : null}
                          {on ? "Assigned" : "Unassigned"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11.5px] text-secondary">
        <span>Total: {items.length}{q ? ` · Showing: ${visible.length}` : ""}</span>
        <span className="font-medium text-foreground">Assigned: {value.length}</span>
      </div>
    </div>
  );
}
